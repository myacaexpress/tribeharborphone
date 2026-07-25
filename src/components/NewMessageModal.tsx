"use client";

import { useMemo, useState } from "react";
import { normalizePhone } from "@/lib/contacts";
import { formatPhone } from "@/lib/format";
import { useTwilio } from "./TwilioProvider";

const MAX_RECIPIENTS = 9;

function splitRecipients(value: string): string[] {
  const recipients = value
    .split(/[,\n;]+/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = normalizePhone(recipient) || recipient;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function NewMessageModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (sid: string) => void;
}) {
  const { contacts } = useTwilio();
  const [numbers, setNumbers] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recipients = useMemo(() => splitRecipients(numbers), [numbers]);
  const isGroup = recipients.length > 1;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (recipients.length === 0) return;
    if (recipients.length > MAX_RECIPIENTS) {
      setError(`Choose no more than ${MAX_RECIPIENTS} recipients.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addresses: recipients,
        friendlyName: name.trim() || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const { sid } = await res.json();
      onCreated(sid);
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not start the conversation");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={create}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="text-lg font-semibold">
          {isGroup ? "New Group Message" : "New Message"}
        </h2>
        <p className="mb-4 mt-1 text-sm text-neutral-500">
          {recipients.length === 0
            ? "Choose who you want to message."
            : isGroup
              ? `${recipients.length} people will share one group MMS thread.`
              : "1 recipient selected."}
        </p>
        <label className="mb-1 block text-sm text-neutral-500">
          To
        </label>
        <textarea
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          rows={2}
          autoFocus
          placeholder="Enter a number or choose contacts below"
          aria-describedby="recipient-help"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <p id="recipient-help" className="mb-3 mt-1 text-xs text-neutral-500">
          Choose 2–9 people for a native group text.
        </p>
        {contacts.length > 0 && (
          <div className="mb-4 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
            {contacts.map((contact) => {
              const selected = recipients.some(
                (value) => normalizePhone(value) === contact.phone,
              );
              return (
                <button
                  key={contact.id}
                  type="button"
                  title={formatPhone(contact.phone)}
                  onClick={() => {
                    if (!selected && recipients.length >= MAX_RECIPIENTS) {
                      setError(`A group can include up to ${MAX_RECIPIENTS} recipients.`);
                      return;
                    }
                    setError(null);
                    setNumbers(
                      selected
                        ? recipients
                            .filter(
                              (value) =>
                                normalizePhone(value) !== contact.phone,
                            )
                            .join(", ")
                        : [...recipients, contact.phone].join(", "),
                    );
                  }}
                  aria-pressed={selected}
                  className={`min-h-11 rounded-full px-3 py-2 text-[13px] ${selected ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"}`}
                >
                  {contact.name}
                </button>
              );
            })}
          </div>
        )}
        {isGroup && (
          <>
            <label className="mb-1 block text-sm text-neutral-500">
              Group name (optional)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Carrier team"
              className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              recipients.length === 0 ||
              recipients.length > MAX_RECIPIENTS
            }
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Creating…" : isGroup ? "Create Group" : "Start"}
          </button>
        </div>
      </form>
    </div>
  );
}
