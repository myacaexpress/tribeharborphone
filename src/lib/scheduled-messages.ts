export const MAX_SCHEDULED_MESSAGE_LENGTH = 1600;
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ScheduledMessageStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type ScheduledMessage = {
  id: string;
  conversationSid: string;
  body: string;
  sendAt: string;
  createdAt: string;
  status: ScheduledMessageStatus;
  attempts: number;
  claimedBy: string | null;
  claimExpiresAt: string | null;
  sentAt: string | null;
  lastError: string | null;
};

export type ScheduledMessageState = {
  version: 1;
  messages: Record<string, ScheduledMessage>;
  updatedAt: string;
};

export function emptyScheduledMessageState(): ScheduledMessageState {
  return {
    version: 1,
    messages: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export function validateScheduledMessageInput(
  conversationSid: string,
  body: string,
  sendAt: string,
  now = new Date(),
): string | null {
  if (!/^CH[0-9a-f]{32}$/i.test(conversationSid)) {
    return "Choose a valid conversation.";
  }
  const trimmed = body.trim();
  if (!trimmed) return "Write a message before scheduling it.";
  if (trimmed.length > MAX_SCHEDULED_MESSAGE_LENGTH) {
    return `Scheduled messages can be up to ${MAX_SCHEDULED_MESSAGE_LENGTH} characters.`;
  }
  const scheduledTime = Date.parse(sendAt);
  if (!Number.isFinite(scheduledTime)) return "Choose a valid date and time.";
  if (scheduledTime <= now.getTime()) {
    return "Choose a time in the future.";
  }
  if (scheduledTime - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
    return "Choose a time within the next year.";
  }
  return null;
}

export function dueScheduledMessages(
  state: ScheduledMessageState,
  now = new Date(),
): ScheduledMessage[] {
  const nowTime = now.getTime();
  return Object.values(state.messages)
    .filter((message) => {
      if (message.status === "pending") {
        return Date.parse(message.sendAt) <= nowTime;
      }
      if (message.status === "sending" && message.claimExpiresAt) {
        return Date.parse(message.claimExpiresAt) <= nowTime;
      }
      return false;
    })
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

export function pendingScheduledMessages(
  state: ScheduledMessageState,
  conversationSid?: string,
): ScheduledMessage[] {
  return Object.values(state.messages)
    .filter(
      (message) =>
        ["pending", "sending"].includes(message.status) &&
        (!conversationSid || message.conversationSid === conversationSid),
    )
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

