"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "@twilio/conversations";
import { formatPhone } from "@/lib/format";
import { contactName, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { conversationTitle } from "./ThreadList";
import { useTwilio } from "./TwilioProvider";

function authorLabel(author: string | null, identity: string, contacts: Contact[]): string {
  if (!author || author === identity) return "Me";
  return contactName(contacts, author) ?? formatPhone(author);
}

export default function ConversationView({
  conversation,
}: {
  conversation: Conversation;
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

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[color:var(--bg-main)]">
      <header
        className="flex items-center gap-2.5 px-5 py-2.5 backdrop-blur-xl"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        <Avatar name={title} size={30} />
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold leading-tight">
            {title}
          </h2>
          {isGroup && (
            <p className="text-[11px] leading-tight text-[color:var(--text-secondary)]">
              Group text
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
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

      <footer className="px-4 pb-4 pt-1">
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
              className="max-h-32 w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-[color:var(--text-secondary)]"
            />
          </div>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="mb-[2px] flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#0a7aff] text-white transition-opacity hover:opacity-90 disabled:opacity-30"
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
