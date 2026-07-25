import { randomUUID } from "node:crypto";
import { CLIENT_IDENTITY, env } from "./env";
import {
  getScheduledMessageState,
  updateScheduledMessageState,
} from "./scheduled-message-state";
import {
  dueScheduledMessages,
  type ScheduledMessage,
} from "./scheduled-messages";
import { restClient } from "./twilio-server";

const CLAIM_DURATION_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

function parseAttributes(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function claimMessage(
  message: ScheduledMessage,
  now: Date,
): Promise<{ message: ScheduledMessage; token: string } | null> {
  const token = randomUUID();
  const next = await updateScheduledMessageState((state) => {
    const current = state.messages[message.id];
    const due =
      current &&
      (current.status === "pending" ||
        (current.status === "sending" &&
          current.claimExpiresAt &&
          Date.parse(current.claimExpiresAt) <= now.getTime())) &&
      Date.parse(current.sendAt) <= now.getTime();
    if (!due) return state;
    return {
      ...state,
      messages: {
        ...state.messages,
        [current.id]: {
          ...current,
          status: "sending",
          claimedBy: token,
          claimExpiresAt: new Date(
            now.getTime() + CLAIM_DURATION_MS,
          ).toISOString(),
        },
      },
      updatedAt: now.toISOString(),
    };
  });
  const claimed = next.messages[message.id];
  return claimed?.claimedBy === token ? { message: claimed, token } : null;
}

async function alreadyDelivered(message: ScheduledMessage): Promise<boolean> {
  const conversation = restClient()
    .conversations.v1.services(env.twilioConversationsServiceSid)
    .conversations(message.conversationSid);
  const recent = await conversation.messages.list({ order: "desc", limit: 100 });
  return recent.some(
    (item) =>
      parseAttributes(item.attributes).tribe_scheduled_message_id === message.id,
  );
}

async function deliver(message: ScheduledMessage): Promise<void> {
  if (await alreadyDelivered(message)) return;
  await restClient()
    .conversations.v1.services(env.twilioConversationsServiceSid)
    .conversations(message.conversationSid)
    .messages.create({
      author: CLIENT_IDENTITY,
      body: message.body,
      attributes: JSON.stringify({
        tribe_scheduled_message_id: message.id,
        tribe_scheduled_message: true,
        version: 1,
      }),
    });
}

async function finishClaim(
  messageId: string,
  token: string,
  now: Date,
  error?: unknown,
): Promise<void> {
  await updateScheduledMessageState((state) => {
    const current = state.messages[messageId];
    if (!current || current.claimedBy !== token) return state;
    const attempts = current.attempts + 1;
    const failed = Boolean(error) && attempts >= MAX_ATTEMPTS;
    return {
      ...state,
      messages: {
        ...state.messages,
        [messageId]: {
          ...current,
          status: error ? (failed ? "failed" : "pending") : "sent",
          attempts,
          claimedBy: null,
          claimExpiresAt: null,
          sentAt: error ? null : now.toISOString(),
          lastError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : error
                ? "Message delivery failed."
                : null,
        },
      },
      updatedAt: now.toISOString(),
    };
  });
}

export async function sendDueScheduledMessages(
  now = new Date(),
): Promise<{ due: number; sent: number; failed: number }> {
  const candidates = dueScheduledMessages(await getScheduledMessageState(), now);
  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claim = await claimMessage(candidate, now);
    if (!claim) continue;
    try {
      await deliver(claim.message);
      await finishClaim(claim.message.id, claim.token, new Date());
      sent += 1;
    } catch (error) {
      await finishClaim(claim.message.id, claim.token, new Date(), error);
      failed += 1;
    }
  }
  return { due: candidates.length, sent, failed };
}

