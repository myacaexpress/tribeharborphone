"use client";

/**
 * Demo mode — renders the real app UI with SYNTHETIC data so the design can
 * be reviewed before Twilio credentials are configured. No real numbers,
 * names, or messages. Not linked from anywhere; visit /demo directly.
 * Append ?call=incoming to preview the incoming-call banner.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Conversation } from "@twilio/conversations";
import type { Call } from "@twilio/voice-sdk";
import AppShell from "@/components/AppShell";
import {
  TwilioContext,
  type TwilioContextValue,
} from "@/components/TwilioProvider";

interface FakeMessage {
  sid: string;
  author: string;
  body: string;
}

function fakeConversation(
  sid: string,
  friendlyName: string,
  participants: number,
  minutesAgo: number,
  unread: number,
  messages: FakeMessage[],
): Conversation {
  const when = new Date(Date.now() - minutesAgo * 60_000);
  const fake = {
    sid,
    friendlyName,
    dateCreated: when,
    lastMessage: { dateCreated: when, index: messages.length - 1 },
    async getMessages(count?: number) {
      const items = messages.slice(-(count ?? 50));
      return { items, hasNextPage: false, hasPrevPage: false };
    },
    async getUnreadMessagesCount() {
      return unread;
    },
    async setAllMessagesRead() {
      return 0;
    },
    async getParticipants() {
      return new Array(participants).fill({});
    },
    async sendMessage() {
      return 0;
    },
  };
  return fake as unknown as Conversation;
}

const DEMO_CONVERSATIONS: Conversation[] = [
  fakeConversation(
    "demo-group",
    "+15555550101, +15555550102",
    3,
    4,
    2,
    [
      { sid: "m1", author: "+15555550101", body: "Marie, can you confirm tomorrow's 10am with the Hendersons?" },
      { sid: "m2", author: "marie", body: "Yes! Calling them this afternoon to confirm and will update the calendar." },
      { sid: "m3", author: "+15555550102", body: "Perfect. Also please reschedule Friday's team check-in to 2pm." },
      { sid: "m4", author: "marie", body: "Done — invite updated. Anything else before I send the weekly summary?" },
      { sid: "m5", author: "+15555550101", body: "That's everything. Thanks Marie! 🙌" },
    ],
  ),
  fakeConversation(
    "demo-shawn",
    "+15555550101",
    2,
    75,
    0,
    [
      { sid: "m1", author: "marie", body: "Good morning! Voicemails from last night are transcribed and in the shared doc." },
      { sid: "m2", author: "+15555550101", body: "Great — flag any that need a same-day callback." },
      { sid: "m3", author: "marie", body: "Two flagged. I'll call both back at 9am your time." },
    ],
  ),
  fakeConversation(
    "demo-vendor",
    "+15555550177",
    2,
    60 * 26,
    0,
    [
      { sid: "m1", author: "+15555550177", body: "Hi, this is Riverside Office Supply confirming your delivery window Thursday 1–3pm." },
      { sid: "m2", author: "marie", body: "Confirmed, someone will be at the office. Thank you!" },
    ],
  ),
];

function DemoInner() {
  const params = useSearchParams();
  const incoming = params.get("call") === "incoming";
  const [voice] = useState<TwilioContextValue["voice"]>(
    incoming
      ? {
          kind: "incoming",
          call: { reject() {}, accept() {} } as unknown as Call,
          from: "+15555550123",
        }
      : { kind: "idle" },
  );

  const value = useMemo<TwilioContextValue>(
    () => ({
      status: "ready",
      errorMessage: null,
      identity: "marie",
      businessNumber: "+15555550100",
      conversations: DEMO_CONVERSATIONS,
      messagesVersion: 0,
      voice,
      muted: false,
      async dial() {},
      acceptIncoming() {},
      rejectIncoming() {},
      hangup() {},
      toggleMute() {},
      sendDigits() {},
    }),
    [voice],
  );

  return (
    <TwilioContext.Provider value={value}>
      <div className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-black">
        DEMO — synthetic data
      </div>
      <AppShell />
    </TwilioContext.Provider>
  );
}

export default function DemoPage() {
  return (
    <Suspense>
      <DemoInner />
    </Suspense>
  );
}
