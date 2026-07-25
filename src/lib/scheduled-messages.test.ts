import assert from "node:assert/strict";
import test from "node:test";
import {
  dueScheduledMessages,
  emptyScheduledMessageState,
  pendingScheduledMessages,
  validateScheduledMessageInput,
  type ScheduledMessage,
} from "./scheduled-messages";

function message(
  id: string,
  sendAt: string,
  status: ScheduledMessage["status"] = "pending",
): ScheduledMessage {
  return {
    id,
    conversationSid: `CH${"a".repeat(32)}`,
    body: `Message ${id}`,
    sendAt,
    createdAt: "2026-07-25T12:00:00.000Z",
    status,
    attempts: 0,
    claimedBy: null,
    claimExpiresAt: null,
    sentAt: null,
    lastError: null,
  };
}

test("validates a future scheduled message", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  assert.equal(
    validateScheduledMessageInput(
      `CH${"a".repeat(32)}`,
      "Hello",
      "2026-07-25T12:15:00.000Z",
      now,
    ),
    null,
  );
  assert.equal(
    validateScheduledMessageInput(
      `CH${"a".repeat(32)}`,
      "Hello",
      "2026-07-25T11:59:00.000Z",
      now,
    ),
    "Choose a time in the future.",
  );
});

test("returns pending messages in send order", () => {
  const state = emptyScheduledMessageState();
  state.messages = {
    later: message("later", "2026-07-25T12:30:00.000Z"),
    sent: message("sent", "2026-07-25T12:05:00.000Z", "sent"),
    sooner: message("sooner", "2026-07-25T12:10:00.000Z"),
  };
  assert.deepEqual(
    pendingScheduledMessages(state).map((item) => item.id),
    ["sooner", "later"],
  );
});

test("reclaims an expired send and ignores an active claim", () => {
  const now = new Date("2026-07-25T12:20:00.000Z");
  const state = emptyScheduledMessageState();
  state.messages = {
    due: message("due", "2026-07-25T12:10:00.000Z"),
    expired: {
      ...message("expired", "2026-07-25T12:05:00.000Z", "sending"),
      claimExpiresAt: "2026-07-25T12:19:00.000Z",
    },
    active: {
      ...message("active", "2026-07-25T12:05:00.000Z", "sending"),
      claimExpiresAt: "2026-07-25T12:21:00.000Z",
    },
  };
  assert.deepEqual(
    dueScheduledMessages(state, now).map((item) => item.id),
    ["expired", "due"],
  );
});

