import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getScheduledMessageState,
  updateScheduledMessageState,
} from "@/lib/scheduled-message-state";
import {
  pendingScheduledMessages,
  validateScheduledMessageInput,
  type ScheduledMessage,
} from "@/lib/scheduled-messages";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const conversationSid = new URL(request.url).searchParams.get(
    "conversationSid",
  );
  if (conversationSid && !/^CH[0-9a-f]{32}$/i.test(conversationSid)) {
    return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });
  }
  const state = await getScheduledMessageState();
  return NextResponse.json(
    { messages: pendingScheduledMessages(state, conversationSid ?? undefined) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let input: {
    conversationSid?: unknown;
    body?: unknown;
    sendAt?: unknown;
  };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const conversationSid =
    typeof input.conversationSid === "string" ? input.conversationSid : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const sendAt = typeof input.sendAt === "string" ? input.sendAt : "";
  const now = new Date();
  const validationError = validateScheduledMessageInput(
    conversationSid,
    body,
    sendAt,
    now,
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const message: ScheduledMessage = {
    id: randomUUID(),
    conversationSid,
    body,
    sendAt: new Date(sendAt).toISOString(),
    createdAt: now.toISOString(),
    status: "pending",
    attempts: 0,
    claimedBy: null,
    claimExpiresAt: null,
    sentAt: null,
    lastError: null,
  };
  await updateScheduledMessageState((state) => ({
    ...state,
    messages: { ...state.messages, [message.id]: message },
    updatedAt: now.toISOString(),
  }));
  return NextResponse.json({ message }, { status: 201 });
}

export async function DELETE(request: Request) {
  let id = "";
  try {
    const input = (await request.json()) as { id?: unknown };
    if (typeof input.id === "string") id = input.id;
  } catch {
    // handled below
  }
  if (!id) {
    return NextResponse.json({ error: "Message id is required." }, { status: 400 });
  }
  let cancelled = false;
  await updateScheduledMessageState((state) => {
    const current = state.messages[id];
    if (!current || !["pending", "sending"].includes(current.status)) {
      return state;
    }
    cancelled = true;
    return {
      ...state,
      messages: {
        ...state.messages,
        [id]: {
          ...current,
          status: "cancelled",
          claimedBy: null,
          claimExpiresAt: null,
        },
      },
      updatedAt: new Date().toISOString(),
    };
  });
  if (!cancelled) {
    return NextResponse.json(
      { error: "That scheduled message is no longer pending." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}

