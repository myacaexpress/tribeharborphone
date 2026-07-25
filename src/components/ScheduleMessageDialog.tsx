"use client";

import { useEffect, useMemo, useState } from "react";

function defaultLocalTime(): string {
  const date = new Date(Date.now() + 15 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function minimumLocalTime(): string {
  const date = new Date(Date.now() + 60_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function ScheduleMessageDialog({
  conversationSid,
  body,
  onClose,
  onScheduled,
}: {
  conversationSid: string;
  body: string;
  onClose: () => void;
  onScheduled: (sendAt: string) => void;
}) {
  const [localTime, setLocalTime] = useState(defaultLocalTime);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minimum = useMemo(() => minimumLocalTime(), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  async function schedule() {
    if (submitting) return;
    const sendAt = new Date(localTime);
    if (!Number.isFinite(sendAt.getTime())) {
      setError("Choose a valid date and time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/scheduled-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationSid,
          body,
          sendAt: sendAt.toISOString(),
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        message?: { sendAt: string };
      };
      if (!response.ok || !result.message) {
        throw new Error(result.error || "Could not schedule the message.");
      }
      onScheduled(result.message.sendAt);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not schedule the message.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-message-title"
        className="w-full rounded-t-[22px] bg-[color:var(--bg-main)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-[420px] sm:rounded-[18px] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="schedule-message-title"
              className="text-[18px] font-semibold tracking-tight"
            >
              Schedule message
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
              It will send even if Tribe Phone is closed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close schedule message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[color:var(--text-secondary)] transition-colors hover:bg-black/[0.05] active:bg-black/[0.1] disabled:opacity-40 dark:hover:bg-white/[0.08]"
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="mt-5 rounded-[14px] bg-[color:var(--field)] px-4 py-3">
          <p className="line-clamp-4 whitespace-pre-wrap text-[14px] leading-relaxed">
            {body.trim()}
          </p>
        </div>

        <label
          htmlFor="scheduled-send-time"
          className="mt-5 block text-[13px] font-semibold"
        >
          Send date and time
        </label>
        <input
          id="scheduled-send-time"
          type="datetime-local"
          value={localTime}
          min={minimum}
          onChange={(event) => {
            setLocalTime(event.target.value);
            setError(null);
          }}
          className="mt-2 min-h-12 w-full rounded-[12px] border border-[color:var(--hairline)] bg-[color:var(--field)] px-3 text-[16px] outline-none focus:border-[#0a7aff] focus:ring-2 focus:ring-[#0a7aff]/25"
        />
        <p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">
          Times use this device&apos;s local time.
        </p>

        {error && (
          <p
            role="alert"
            aria-live="polite"
            className="mt-3 text-[13px] leading-snug text-red-500"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-12 flex-1 rounded-[12px] border border-[color:var(--hairline)] font-semibold transition-colors hover:bg-black/[0.04] active:bg-black/[0.08] disabled:opacity-40 dark:hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void schedule()}
            disabled={submitting}
            className="min-h-12 flex-[1.35] rounded-[12px] bg-[#0a7aff] px-4 font-semibold text-white transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-45"
          >
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </section>
    </div>
  );
}
