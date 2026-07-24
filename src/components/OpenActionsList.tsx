"use client";

import { useState } from "react";
import { useTwilio } from "./TwilioProvider";
import ActionDetailsModal from "./ActionDetailsModal";
import type { WorkspaceAction } from "@/lib/workspace";

const PRIORITY_STYLE: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Normal: "bg-[#0a7aff]",
  Low: "bg-slate-400",
};

export default function OpenActionsList() {
  const {
    openActions,
    workspaceStatus,
    workspaceError,
    refreshWorkspace,
    updateActionStatus,
  } = useTwilio();
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] =
    useState<WorkspaceAction | null>(null);

  async function complete(actionId: string): Promise<boolean> {
    setUpdating(actionId);
    setError(null);
    try {
      await updateActionStatus(actionId, "Complete");
      return true;
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not mark the action done.",
      );
      return false;
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section
      aria-labelledby="open-actions-title"
      className="flex max-h-[38%] min-h-[116px] flex-col"
      style={{ borderTop: "1px solid var(--hairline)" }}
    >
      <header className="flex min-h-11 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2
            id="open-actions-title"
            className="text-[13px] font-semibold tracking-tight"
          >
            Open actions
          </h2>
          {workspaceStatus === "ready" && (
            <span className="rounded-full bg-[color:var(--field)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--text-secondary)]">
              {openActions.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshWorkspace()}
          disabled={workspaceStatus === "loading"}
          className="min-h-11 min-w-11 touch-manipulation rounded-[10px] px-2 text-[12px] font-semibold text-[#0a7aff] disabled:opacity-50"
        >
          {workspaceStatus === "loading" ? "Syncing…" : "Refresh"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {workspaceStatus === "loading" && openActions.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-[color:var(--text-secondary)]">
            Loading Command Center…
          </p>
        ) : workspaceStatus === "error" && openActions.length === 0 ? (
          <p role="alert" className="px-4 py-3 text-[12px] text-red-500">
            {workspaceError}
          </p>
        ) : openActions.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-[color:var(--text-secondary)]">
            Nothing open.
          </p>
        ) : (
          openActions.map((action) => (
            <div
              key={action.id}
              className="mx-2 flex min-h-[60px] items-start gap-1 rounded-[10px] px-2 py-1 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            >
              <button
                type="button"
                aria-label={`Mark ${action.id} done`}
                disabled={updating === action.id}
                onClick={() => void complete(action.id)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className="h-6 w-6 rounded-full border-2 border-[#0a7aff]"
                />
              </button>
              <button
                type="button"
                aria-label={`View details for ${action.affectedRecord}`}
                onClick={() => setSelectedAction(action)}
                className="flex min-h-[52px] min-w-0 flex-1 touch-manipulation items-center gap-1 rounded-[8px] py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0a7aff]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        PRIORITY_STYLE[action.priority] ?? "bg-slate-400"
                      }`}
                    />
                    <span className="truncate text-[12px] font-semibold">
                      {action.affectedRecord}
                    </span>
                    {action.dueDate && (
                      <span className="ml-auto shrink-0 text-[10px] text-[color:var(--text-secondary)]">
                        {action.dateStatus || action.dueDate}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[color:var(--text-secondary)]">
                    {action.action}
                  </span>
                </span>
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-[color:var(--text-secondary)]"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          ))
        )}
        {error && (
          <p role="alert" aria-live="polite" className="px-4 pb-2 text-[11px] text-red-500">
            {error}
          </p>
        )}
      </div>
      {selectedAction && (
        <ActionDetailsModal
          action={selectedAction}
          updating={updating === selectedAction.id}
          error={error}
          onClose={() => setSelectedAction(null)}
          onComplete={async () => {
            const completed = await complete(selectedAction.id);
            if (completed) setSelectedAction(null);
          }}
        />
      )}
    </section>
  );
}
