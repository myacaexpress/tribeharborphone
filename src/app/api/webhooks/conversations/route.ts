import { after, NextResponse } from "next/server";
import { CLIENT_IDENTITY, env } from "@/lib/env";
import {
  formParams,
  restClient,
  validateTwilioSignature,
} from "@/lib/twilio-server";
import { normalizePhone } from "@/lib/contacts";
import {
  classifySupportMessage,
} from "@/lib/support-ai";
import {
  findSupportedActionContext,
  isOptOutMessage,
  shouldAutoAcknowledge,
  shouldWelcomeToTribe,
  supportAcknowledgement,
} from "@/lib/support-policy";
import { getWorkspace } from "@/lib/workspace";

type MessageAttributes = Record<string, unknown> & {
  tribe_support_ack?: {
    status?: "processing" | "sent" | "ignored" | "error";
    updated_at?: string;
    intent?: string;
    confidence?: number;
    reason?: string;
  };
};

const AUTO_REPLY_DELAY_MS = 10_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseAttributes(value: string | null | undefined): MessageAttributes {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as MessageAttributes)
      : {};
  } catch {
    return {};
  }
}

function alreadyHandled(attributes: MessageAttributes): boolean {
  const marker = attributes.tribe_support_ack;
  if (!marker?.status) return false;
  if (marker.status === "sent" || marker.status === "ignored") return true;
  if (marker.status !== "processing" || !marker.updated_at) return false;
  const elapsed = Date.now() - Date.parse(marker.updated_at);
  return Number.isFinite(elapsed) && elapsed < 2 * 60_000;
}

async function handleInboundSupportMessage(
  params: Record<string, string>,
): Promise<void> {
  const {
    Author: author,
    Body: body,
    ConversationSid: conversationSid,
    MessageSid: messageSid,
  } = params;
  if (!author || !body?.trim() || !conversationSid || !messageSid) return;
  if (
    author === CLIENT_IDENTITY ||
    normalizePhone(author) === normalizePhone(env.twilioPhoneNumber) ||
    isOptOutMessage(body)
  ) {
    return;
  }

  const workspace = await getWorkspace();
  const supported = findSupportedActionContext(author, workspace);
  if (!supported) return;

  const service = restClient().conversations.v1.services(
    env.twilioConversationsServiceSid,
  );
  const conversation = service.conversations(conversationSid);
  const message = await conversation.messages(messageSid).fetch();
  const attributes = parseAttributes(message.attributes);
  if (alreadyHandled(attributes)) return;

  const processingAt = new Date().toISOString();
  await conversation.messages(messageSid).update({
    xTwilioWebhookEnabled: "false",
    attributes: JSON.stringify({
      ...attributes,
      tribe_support_ack: {
        status: "processing",
        updated_at: processingAt,
      },
    }),
  });

  try {
    await delay(AUTO_REPLY_DELAY_MS);

    const recent = await conversation.messages.list({
      order: "desc",
      limit: 30,
    });
    const currentPosition = recent.findIndex((item) => item.sid === messageSid);
    const messagesAfterCurrent =
      currentPosition >= 0 ? recent.slice(0, currentPosition) : [];
    const hasNewerSupportedAgentMessage = messagesAfterCurrent.some(
      (item) =>
        normalizePhone(item.author ?? "") === normalizePhone(author),
    );

    if (hasNewerSupportedAgentMessage) {
      await conversation.messages(messageSid).update({
        xTwilioWebhookEnabled: "false",
        attributes: JSON.stringify({
          ...attributes,
          tribe_support_ack: {
            status: "ignored",
            updated_at: new Date().toISOString(),
            reason: "superseded_by_newer_message",
          },
        }),
      });
      return;
    }

    const recentMessages = recent
      .filter((item) => item.sid !== messageSid && item.body)
      .reverse()
      .map((item) => ({
        speaker:
          normalizePhone(item.author ?? "") === normalizePhone(author)
            ? ("supported_agent" as const)
            : item.author === CLIENT_IDENTITY
              ? ("tribe_support" as const)
              : ("group_member" as const),
        text: item.body ?? "",
      }));
    const classification = await classifySupportMessage({
      body,
      action: supported.action,
      recentMessages,
    });

    if (!shouldAutoAcknowledge(classification)) {
      await conversation.messages(messageSid).update({
        xTwilioWebhookEnabled: "false",
        attributes: JSON.stringify({
          ...attributes,
          tribe_support_ack: {
            status: "ignored",
            updated_at: new Date().toISOString(),
            intent: classification.intent,
            confidence: classification.confidence,
          },
        }),
      });
      return;
    }

    await conversation.messages.create({
      author: CLIENT_IDENTITY,
      body: supportAcknowledgement(
        supported.action.owner,
        shouldWelcomeToTribe(recentMessages),
      ),
      attributes: JSON.stringify({
        tribe_support_auto: true,
        in_reply_to: messageSid,
        action_id: supported.action.id,
        version: 2,
      }),
    });
    await conversation.messages(messageSid).update({
      xTwilioWebhookEnabled: "false",
      attributes: JSON.stringify({
        ...attributes,
        tribe_support_ack: {
          status: "sent",
          updated_at: new Date().toISOString(),
          intent: classification.intent,
          confidence: classification.confidence,
        },
      }),
    });
  } catch (error) {
    console.error("Inbound support classification failed", {
      conversationSid,
      messageSid,
      error: error instanceof Error ? error.message : "unknown error",
    });
    await conversation.messages(messageSid).update({
      xTwilioWebhookEnabled: "false",
      attributes: JSON.stringify({
        ...attributes,
        tribe_support_ack: {
          status: "error",
          updated_at: new Date().toISOString(),
        },
      }),
    });
  }
}

function projectedAddress(binding: unknown): string | null {
  if (!binding || typeof binding !== "object") return null;
  const values = binding as Record<string, unknown>;
  const address =
    values.projected_address ??
    values.projectedAddress ??
    values.ProjectedAddress;
  return typeof address === "string" ? address : null;
}

function participantAddress(binding: unknown): string | null {
  if (!binding || typeof binding !== "object") return null;
  const values = binding as Record<string, unknown>;
  const address = values.address ?? values.Address;
  return typeof address === "string" ? address : null;
}

async function joinBrowserIdentity(conversationSid: string) {
  const client = restClient();
  const service = client.conversations.v1.services(
    env.twilioConversationsServiceSid,
  );
  const conversation = service.conversations(conversationSid);
  const participants = await conversation.participants.list({ limit: 10 });

  if (participants.some((participant) => participant.identity === CLIENT_IDENTITY)) {
    return;
  }

  const projectedParticipant = participants.find(
    (participant) =>
      !participant.identity &&
      projectedAddress(participant.messagingBinding) === env.twilioPhoneNumber,
  );

  if (projectedParticipant) {
    await conversation
      .participants(projectedParticipant.sid)
      .update({ identity: CLIENT_IDENTITY });
  } else {
    await conversation.participants.create({ identity: CLIENT_IDENTITY });
  }

  const current = await conversation.fetch();
  if (!current.friendlyName) {
    const addresses = participants
      .map((participant) => participantAddress(participant.messagingBinding))
      .filter((address): address is string => Boolean(address));
    if (addresses.length > 0) {
      await conversation.update({ friendlyName: addresses.join(", ") });
    }
  }
}

/**
 * Conversations service post-event webhook.
 *
 * Inbound Group MMS conversations begin in `initializing`, when Twilio rejects
 * participant changes. We acknowledge that first event, then attach Marie to
 * the projected business number after `onConversationStateUpdated` reports the
 * active conversation. Ordinary inbound SMS conversations can still join on
 * `onConversationAdded`.
 */
export async function POST(request: Request) {
  const params = await formParams(request);
  if (!validateTwilioSignature(request, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  if (
    (params.EventType === "onConversationAdded" ||
      params.EventType === "onConversationStateUpdated") &&
    params.ConversationSid
  ) {
    try {
      await joinBrowserIdentity(params.ConversationSid);
    } catch (error) {
      // 50433: participant already exists — fine, nothing to do.
      // 50386: an atomic/inbound group is still initializing. Twilio will
      // deliver onConversationStateUpdated after it becomes active.
      const code = (error as { code?: number }).code;
      if (code !== 50433 && code !== 50386) throw error;
    }
  }

  if (params.EventType === "onMessageAdded") {
    after(async () => {
      try {
        await handleInboundSupportMessage(params);
      } catch (error) {
        console.error("Inbound support webhook failed", {
          conversationSid: params.ConversationSid,
          messageSid: params.MessageSid,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}
