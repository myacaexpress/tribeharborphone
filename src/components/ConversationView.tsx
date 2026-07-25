"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  function resizeComposer() {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${composer.scrollHeight}px`;
    composer.style.overflowY = "hidden";
  }

  useLayoutEffect(() => {
    resizeComposer();
  }, [draft]);

  useEffect(() => {
    window.addEventListener("resize", resizeComposer);
    return () => window.removeEventListener("resize", resizeComposer);
  }, []);

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

  async function draftReply() {
    if (drafting || sending) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const response = await fetch("/api/ai/conversation-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationSid: conversation.sid,
          currentDraft: draft,
        }),
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.message) {
        throw new Error(result.error || "Could not draft a reply.");
      }
      setDraft(result.message);
      window.setTimeout(() => {
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange(
          result.message!.length,
          result.message!.length,
        );
      }, 0);
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : "Could not draft a reply.",
      );
    } finally {
      setDrafting(false);
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
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
        {draftError && (
          <p
            role="alert"
            aria-live="polite"
            className="mb-1.5 px-2 text-[12px] leading-snug text-red-500"
          >
            {draftError}
          </p>
        )}
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
              ref={composerRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Text Message · SMS"
              className="min-h-6 w-full resize-none overflow-y-hidden bg-transparent text-[16px] leading-6 outline-none placeholder:text-[color:var(--text-secondary)] sm:text-[15px]"
            />
          </div>
          <button
            type="button"
            disabled={drafting || sending}
            onClick={() => void draftReply()}
            aria-label="Draft reply with AI"
            title="Draft from this thread and the matching open action"
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-[color:var(--hairline)] bg-[color:var(--field)] text-[#0a7aff] transition-opacity hover:opacity-80 active:opacity-65 disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
          >
            {drafting ? (
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                className="animate-spin"
              >
                <path
                  d="M20 12a8 8 0 1 1-2.34-5.66"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3ZM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[#0a7aff] text-white transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
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
