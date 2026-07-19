"use client";

import { useMemo, useState } from "react";
import DialerModal from "./DialerModal";
import ConversationView from "./ConversationView";
import NewMessageModal from "./NewMessageModal";
import ThreadList from "./ThreadList";
import { useTwilio } from "./TwilioProvider";
import VoiceOverlay from "./VoiceOverlay";
import ContactsModal from "./ContactsModal";

function ToolbarButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#0a7aff] transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/[0.08]"
    >
      {children}
    </button>
  );
}

export default function AppShell() {
  const {
    status,
    errorMessage,
    voiceStatus,
    voiceErrorMessage,
    conversations,
  } = useTwilio();
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [showDialer, setShowDialer] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [contactPhone, setContactPhone] = useState<string | null>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.sid === selectedSid) ?? null,
    [conversations, selectedSid],
  );

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="mb-1 text-[17px] font-semibold">Can’t connect</h1>
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            {errorMessage}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen overflow-hidden">
      <VoiceOverlay />

      <aside
        className="flex w-[320px] shrink-0 flex-col backdrop-blur-2xl"
        style={{
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--hairline)",
        }}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-[20px] font-bold tracking-tight">Messages</h1>
          <div className="flex gap-1">
            <ToolbarButton label="Contacts" onClick={() => {
              setContactPhone(null);
              setShowContacts(true);
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19c.4-3.4 2.2-5.2 5.5-5.2s5.1 1.8 5.5 5.2" />
                <path d="M18 7v6M15 10h6" strokeLinecap="round" />
              </svg>
            </ToolbarButton>
            <ToolbarButton
              label={
                voiceStatus === "error"
                  ? `Calling unavailable: ${voiceErrorMessage ?? "Twilio Voice failed to connect"}`
                  : voiceStatus === "loading"
                    ? "Connecting calling…"
                    : "Make a call"
              }
              disabled={voiceStatus !== "ready"}
              onClick={() => setShowDialer(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.6 3.2c.6-.6 1.6-.6 2.2.1l1.9 2.3c.5.6.5 1.5 0 2.1l-1 1.2c-.2.3-.3.7-.1 1 .8 1.6 2.9 3.7 4.5 4.5.3.2.7.1 1-.1l1.2-1c.6-.5 1.5-.5 2.1 0l2.3 1.9c.7.6.7 1.6.1 2.2l-1.2 1.3c-.6.6-1.5.9-2.3.7-3.2-.8-6.2-2.5-8.6-4.9S4.7 9.1 3.9 5.9c-.2-.8 0-1.7.7-2.3l2-.4Z" />
              </svg>
            </ToolbarButton>
            <ToolbarButton label="New message" onClick={() => setShowCompose(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="13" height="16" rx="3" />
                <path d="M18.6 3.4a1.9 1.9 0 0 1 2.7 2.7l-7.4 7.4-3.2.5.5-3.2 7.4-7.4Z" fill="var(--bg-sidebar)" />
              </svg>
            </ToolbarButton>
          </div>
        </div>
        <ThreadList selectedSid={selectedSid} onSelect={setSelectedSid} />
        <button
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="px-4 py-2.5 text-left text-[11px] text-[color:var(--text-secondary)] transition-colors hover:text-foreground"
          style={{ borderTop: "1px solid var(--hairline)" }}
        >
          Sign out
        </button>
      </aside>

      {selected ? (
        <ConversationView
          key={selected.sid}
          conversation={selected}
          onOpenContact={(phone) => {
            setContactPhone(phone ?? null);
            setShowContacts(true);
          }}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="text-[15px] font-semibold text-[color:var(--text-secondary)]">
            {status === "loading" ? "Connecting…" : "No Conversation Selected"}
          </p>
          {status !== "loading" && (
            <p className="text-[13px] text-[color:var(--text-secondary)]">
              Choose a conversation or compose a new message
            </p>
          )}
        </div>
      )}

      {showDialer && <DialerModal onClose={() => setShowDialer(false)} />}
      {showContacts && (
        <ContactsModal
          key={contactPhone ?? "directory"}
          initialPhone={contactPhone}
          onClose={() => setShowContacts(false)}
        />
      )}
      {showCompose && (
        <NewMessageModal
          onClose={() => setShowCompose(false)}
          onCreated={(sid) => {
            setShowCompose(false);
            setSelectedSid(sid);
          }}
        />
      )}
    </main>
  );
}
