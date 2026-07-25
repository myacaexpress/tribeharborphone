import { useEffect, useRef, useState } from "react";
import type { WorkspaceAction } from "@/lib/workspace";

const PRIORITY_STYLE: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Normal: "bg-[#0a7aff]",
  Low: "bg-slate-400",
};

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
        {label}
      </dt>
      <dd className="mt-1 text-[14px] leading-snug">{value}</dd>
    </div>
  );
}

export default function ActionDetailsModal({
  action,
  updating,
  error,
  onClose,
  onComplete,
}: {
  action: WorkspaceAction;
  updating: boolean;
  error: string | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generateDraft() {
    setDrafting(true);
    setDraftError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/ai/support-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id }),
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.message) {
        throw new Error(result.error || "Could not draft a message.");
      }
      setDraft(result.message);
    } catch (draftFailure) {
      setDraftError(
        draftFailure instanceof Error
          ? draftFailure.message
          : "Could not draft a message.",
      );
    } finally {
      setDrafting(false);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setDraftError(null);
    } catch {
      setDraftError("Could not copy the message. Select and copy it manually.");
    }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-details-title"
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[24px] bg-[color:var(--bg-main)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-md sm:rounded-[18px] sm:p-5"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-1 w-9 rounded-full bg-[color:var(--hairline)] sm:hidden"
        />

        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  PRIORITY_STYLE[action.priority] ?? "bg-slate-400"
                }`}
              />
              <span className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
                {action.priority || "Normal"} priority
              </span>
            </div>
            <h2
              id="action-details-title"
              className="mt-2 text-[21px] font-semibold leading-tight tracking-tight"
            >
              {action.affectedRecord}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close action details"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[color:var(--field)] text-[color:var(--text-secondary)] transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div
          className="my-5 h-px"
          style={{ background: "var(--hairline)" }}
        />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
            What needs to be done
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed">
            {action.action}
          </p>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5">
          <Detail
            label="Due"
            value={action.dateStatus || action.dueDate}
          />
          <Detail label="Status" value={action.status} />
          <Detail label="Owner" value={action.owner} />
          <Detail label="Type" value={action.recordType} />
          <Detail label="Source status" value={action.sourceStatus} />
          <Detail label="Last checked" value={action.sourceCheckedAt} />
        </dl>

        {action.uploadUrl && (
          <section className="mt-6 rounded-[14px] border border-[#0a7aff]/30 bg-[#0a7aff]/[0.06] p-4">
            <h3 className="text-[15px] font-semibold">Upload requested item</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
              This approved source link can be opened here or included in the
              editable support message.
            </p>
            <a
              href={action.uploadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex min-h-11 w-full touch-manipulation items-center justify-center rounded-[11px] bg-[#0a7aff] px-4 text-[14px] font-semibold text-white"
            >
              Open upload page
            </a>
          </section>
        )}

        {action.blocker && (
          <div className="mt-6 rounded-[12px] bg-[color:var(--field)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
              Blocker
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">{action.blocker}</p>
          </div>
        )}

        <section
          aria-labelledby="support-message-title"
          className="mt-6 rounded-[14px] bg-[color:var(--field)] p-4"
        >
          <h3 id="support-message-title" className="text-[15px] font-semibold">
            Support message
          </h3>
          {!draft ? (
            <>
              <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                Draft a personal check-in based on this next action.
              </p>
              <button
                type="button"
                disabled={drafting}
                onClick={() => void generateDraft()}
                className="mt-4 min-h-11 w-full touch-manipulation rounded-[11px] bg-[#0a7aff] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#006ee6] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
              >
                {drafting ? "Drafting…" : "Draft support message"}
              </button>
            </>
          ) : (
            <>
              <label
                htmlFor="support-message-draft"
                className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]"
              >
                Message preview
              </label>
              <textarea
                id="support-message-draft"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setCopied(false);
                }}
                rows={6}
                className="mt-2 w-full resize-y rounded-[10px] border border-[color:var(--hairline)] bg-[color:var(--bg-main)] px-3 py-2.5 text-[14px] leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0a7aff]"
              />
              <p className="mt-2 text-[11px] text-[color:var(--text-secondary)]">
                Review only — nothing is sent automatically.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={drafting}
                  onClick={() => void generateDraft()}
                  className="min-h-11 touch-manipulation rounded-[10px] border border-[color:var(--hairline)] px-3 text-[13px] font-semibold disabled:opacity-50"
                >
                  {drafting ? "Drafting…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  onClick={() => void copyDraft()}
                  className="min-h-11 touch-manipulation rounded-[10px] bg-[#0a7aff] px-3 text-[13px] font-semibold text-white"
                >
                  {copied ? "Copied" : "Copy message"}
                </button>
              </div>
            </>
          )}
          {draftError && (
            <p
              role="alert"
              className="mt-3 text-[12px] leading-snug text-red-500"
            >
              {draftError}
            </p>
          )}
        </section>

        {error && (
          <p
            role="alert"
            aria-live="polite"
            className="mt-5 rounded-[10px] bg-red-500/10 px-3 py-2.5 text-[13px] leading-snug text-red-500"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={updating}
          onClick={() => void onComplete()}
          className="mt-7 min-h-12 w-full touch-manipulation rounded-[13px] bg-[#0a7aff] px-4 text-[16px] font-semibold text-white transition-colors hover:bg-[#006ee6] active:bg-[#0060cc] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7aff]"
        >
          {updating ? "Marking done…" : "Mark done"}
        </button>

        <p className="mt-3 text-center text-[11px] text-[color:var(--text-secondary)]">
          Action {action.id}
        </p>
      </section>
    </div>
  );
}
