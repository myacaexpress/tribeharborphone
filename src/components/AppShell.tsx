"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import DialerModal from "./DialerModal";
import ConversationView from "./ConversationView";
import NewMessageModal from "./NewMessageModal";
import ThreadList from "./ThreadList";
import { useTwilio } from "./TwilioProvider";
import VoiceOverlay from "./VoiceOverlay";
import ContactsModal from "./ContactsModal";
import OpenActionsList from "./OpenActionsList";

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
      className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-[10px] text-[#0a7aff] transition-colors hover:bg-black/[0.05] active:bg-black/[0.08] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12] sm:h-9 sm:w-9"
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
  const [savedContactName, setSavedContactName] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = Number(
        window.localStorage.getItem("tribe-sidebar-width"),
      );
      if (Number.isFinite(stored) && stored >= 280 && stored <= 520) {
        setSidebarWidth(stored);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function saveSidebarWidth(width: number) {
    const next = Math.min(520, Math.max(280, Math.round(width)));
    setSidebarWidth(next);
    window.localStorage.setItem("tribe-sidebar-width", String(next));
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (moveEvent: PointerEvent) => {
      saveSidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  useEffect(() => {
    if (!savedContactName) return;
    const timeout = window.setTimeout(() => setSavedContactName(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [savedContactName]);

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
    <main className="flex h-dvh overflow-hidden">
      <VoiceOverlay />

      <aside
        className={`${selected ? "hidden sm:flex" : "flex"} w-full shrink-0 flex-col backdrop-blur-2xl sm:w-[var(--sidebar-width)]`}
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
          background: "var(--bg-sidebar)",
        } as CSSProperties}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4">
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
        <OpenActionsList />
        <button
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="min-h-11 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 text-left text-[12px] text-[color:var(--text-secondary)] transition-colors hover:text-foreground sm:pb-2.5"
          style={{ borderTop: "1px solid var(--hairline)" }}
        >
          Sign out
        </button>
      </aside>
      <button
        type="button"
        role="separator"
        aria-label="Resize conversations and actions column"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={520}
        aria-valuenow={sidebarWidth}
        onPointerDown={beginSidebarResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            saveSidebarWidth(sidebarWidth - 20);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            saveSidebarWidth(sidebarWidth + 20);
          }
          if (event.key === "Home") {
            event.preventDefault();
            saveSidebarWidth(280);
          }
          if (event.key === "End") {
            event.preventDefault();
            saveSidebarWidth(520);
          }
        }}
        className="group relative z-10 hidden w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-[color:var(--bg-main)] focus-visible:outline-none sm:flex"
      >
        <span className="w-px bg-[color:var(--hairline)] transition-colors group-hover:bg-[#0a7aff] group-focus-visible:bg-[#0a7aff]" />
      </button>

      {selected ? (
        <ConversationView
          key={selected.sid}
          conversation={selected}
          onBack={() => setSelectedSid(null)}
          onOpenContact={(phone) => {
            setContactPhone(phone ?? null);
            setShowContacts(true);
          }}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-1 text-center sm:flex">
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
          onSaved={(contactName) => {
            setSavedContactName(contactName);
            setShowContacts(false);
          }}
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
      {savedContactName && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-[#262629] px-4 py-2 text-[13px] font-semibold text-white shadow-xl"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {savedContactName} saved
        </div>
      )}
    </main>
  );
}
