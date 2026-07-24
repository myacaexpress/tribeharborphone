"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "@twilio/conversations";
import { formatPhone } from "@/lib/format";
import { contactName, normalizePhone, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { conversationTitle } from "./ThreadList";
import { useTwilio } from "./TwilioProvider";

function authorLabel(author: string | null, identity: string, contacts: Contact[]): string {
  if (!author || author === identity) return "Me";
  return contactName(contacts, author) ?? formatPhone(author);
}

export default function ConversationView({
  conversation,
  onBack,
  onOpenContact,
}: {
  conversation: Conversation;
  onBack: () => void;
  onOpenContact: (phone?: string) => void;
}) {
  const { identity, messagesVersion, contacts } = useTwilio();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await conversation.getMessages(50);
        if (!cancelled) setMessages(page.items);
        await conversation.setAllMessagesRead();
      } catch {
        // keep whatever we have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation, messagesVersion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, conversation.sid]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await conversation.sendMessage(text);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  // Group thread = more than one non-me participant (label senders).
  const [isGroup, setIsGroup] = useState(false);
  useEffect(() => {
    conversation
      .getParticipants()
      .then((ps) => setIsGroup(ps.length > 2))
      .catch(() => setIsGroup(false));
  }, [conversation]);

  const title = conversationTitle(conversation, contacts);
  const friendlyNamePhones = (conversation.friendlyName ?? "")
    .split(",")
    .map(normalizePhone)
    .filter(Boolean);
  const messagePhones = messages
    .map((message) => message.author ?? "")
    .filter((author) => author !== identity)
    .map(normalizePhone)
    .filter(Boolean);
  const peerPhone = !isGroup
    ? friendlyNamePhones[0] ?? messagePhones[0]
    : undefined;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[color:var(--bg-main)]">
      <header
        className="flex min-h-14 items-center gap-2 px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-xl sm:gap-2.5 sm:px-5 sm:py-2.5"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="flex h-11 min-w-11 touch-manipulation items-center justify-center gap-0.5 rounded-[10px] px-1 text-[#0a7aff] transition-colors active:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff] dark:active:bg-white/[0.08] sm:hidden"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onOpenContact(peerPhone)}
          aria-label={peerPhone ? `Open contact for ${title}` : `Open contacts for ${title}`}
          title={peerPhone ? "View or edit contact" : "Open contacts"}
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-opacity hover:opacity-80 active:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
        >
          <Avatar name={title} size={34} />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold leading-tight">
            {title}
          </h2>
          {isGroup && (
            <p className="text-[11px] leading-tight text-[color:var(--text-secondary)]">
              Group text
            </p>
          )}
          {!isGroup && (
            <p className="text-[11px] leading-tight text-[color:var(--text-secondary)]">
              Tap photo for contact info
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {messages.map((message, i) => {
          const mine = (message.author ?? "") === identity;
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newSender = !prev || prev.author !== message.author;
          const lastInRun = !next || next.author !== message.author;
          return (
            <div
              key={message.sid}
              className={`flex flex-col ${mine ? "items-end" : "items-start"} ${
                newSender ? "mt-2.5" : "mt-[3px]"
              }`}
            >
              {isGroup && !mine && newSender && (
                <span className="mb-0.5 ml-3 text-[11px] text-[color:var(--text-secondary)]">
                  {authorLabel(message.author, identity, contacts)}
                </span>
              )}
              <div
                className={`imsg ${
                  mine
                    ? `imsg-me ${lastInRun ? "imsg-tail-me" : ""}`
                    : `imsg-them ${lastInRun ? "imsg-tail-them" : ""}`
                }`}
              >
                {message.body ?? "Attachment"}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <footer className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 sm:px-4 sm:pb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <div
            className="flex flex-1 items-end rounded-[20px] px-4 py-[7px]"
            style={{ border: "1px solid var(--hairline)", background: "var(--bg-main)" }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Text Message · SMS"
              className="max-h-32 w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-[color:var(--text-secondary)] sm:text-[15px]"
            />
          </div>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[#0a7aff] text-white transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-30 sm:mb-[2px] sm:h-[34px] sm:w-[34px]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 20V5M12 5l-6.5 6.5M12 5l6.5 6.5"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}
