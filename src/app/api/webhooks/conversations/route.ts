import { NextResponse } from "next/server";
import { CLIENT_IDENTITY, env } from "@/lib/env";
import {
  formParams,
  restClient,
  validateTwilioSignature,
} from "@/lib/twilio-server";

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

  return NextResponse.json({ ok: true });
}
