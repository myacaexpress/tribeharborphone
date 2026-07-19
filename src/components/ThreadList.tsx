"use client";

import { useEffect, useState } from "react";
import type { Conversation } from "@twilio/conversations";
import { formatTime } from "@/lib/format";
import { resolveConversationName, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { useTwilio } from "./TwilioProvider";

export function conversationTitle(conversation: Conversation, contacts: Contact[]): string {
  return resolveConversationName(conversation.friendlyName, contacts);
}

function ThreadRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { messagesVersion, contacts } = useTwilio();
  const [preview, setPreview] = useState("");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [page, count] = await Promise.all([
          conversation.getMessages(1),
          conversation.getUnreadMessagesCount(),
        ]);
        if (cancelled) return;
        const last = page.items[page.items.length - 1];
        setPreview(last?.body ?? (last ? "Attachment" : "No messages yet"));
        setUnread(count ?? 0);
      } catch {
        // leave defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation, messagesVersion]);

  const when =
    conversation.lastMessage?.dateCreated ?? conversation.dateCreated;
  const title = conversationTitle(conversation, contacts);

  return (
    <button
      onClick={onSelect}
      className={`group relative mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
        selected ? "bg-[#0a7aff] text-white" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      }`}
    >
      <span
        className={`absolute left-[-1px] h-[7px] w-[7px] rounded-full ${
          unread > 0 && !selected ? "bg-[#0a7aff]" : "bg-transparent"
        }`}
      />
      <Avatar name={title} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold">{title}</span>
          <span
            className={`shrink-0 text-[12px] font-normal ${
              selected ? "text-white/75" : "text-[color:var(--text-secondary)]"
            }`}
          >
            {formatTime(when)}
          </span>
        </div>
        <p
          className={`mt-px line-clamp-2 text-[13px] leading-snug ${
            selected ? "text-white/80" : "text-[color:var(--text-secondary)]"
          }`}
        >
          {preview}
        </p>
      </div>
    </button>
  );
}

export default function ThreadList({
  selectedSid,
  onSelect,
}: {
  selectedSid: string | null;
  onSelect: (sid: string) => void;
}) {
  const { conversations, status, contacts } = useTwilio();
  const [query, setQuery] = useState("");

  const visible = query.trim()
    ? conversations.filter((c) =>
        conversationTitle(c, contacts).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : conversations;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <div className="flex items-center gap-1.5 rounded-[8px] bg-[color:var(--field)] px-2.5 py-[5px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0 opacity-40">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.4" />
            <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-secondary)]"
          />
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto pb-2">
        {status === "loading" ? (
          <p className="px-5 py-3 text-[13px] text-[color:var(--text-secondary)]">
            Loading conversations…
          </p>
        ) : visible.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-[color:var(--text-secondary)]">
            {query ? "No results" : "No conversations yet. Tap ✎ to start one."}
          </p>
        ) : (
          visible.map((c) => (
            <ThreadRow
              key={c.sid}
              conversation={c}
              selected={c.sid === selectedSid}
              onSelect={() => onSelect(c.sid)}
            />
          ))
        )}
      </div>
    </div>
  );
}
