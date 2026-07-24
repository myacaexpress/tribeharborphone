"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPhone } from "@/lib/format";
import { normalizePhone, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { useTwilio } from "./TwilioProvider";

const EMPTY_DRAFT = { id: "", name: "", phone: "", group: "" };
type PendingAction =
  | { kind: "close" }
  | { kind: "back" }
  | { kind: "new" }
  | { kind: "edit"; contact: Contact };

export default function ContactsModal({
  onClose,
  initialPhone = null,
}: {
  onClose: () => void;
  initialPhone?: string | null;
}) {
  const { contacts, saveContact, deleteContact } = useTwilio();
  const normalizedInitialPhone = initialPhone ? normalizePhone(initialPhone) : "";
  const initialContact = normalizedInitialPhone
    ? contacts.find((contact) => contact.phone === normalizedInitialPhone) ?? null
    : null;
  const initialDraft = initialContact ?? {
    ...EMPTY_DRAFT,
    phone: normalizedInitialPhone,
  };
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null>(initialContact);
  const [draft, setDraft] = useState(initialDraft);
  const [baseline, setBaseline] = useState(initialDraft);
  const [showEditor, setShowEditor] = useState(Boolean(normalizedInitialPhone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const launchedFromConversation = Boolean(normalizedInitialPhone);
  const syncedContact = editing?.source === "sheet";
  const isDirty =
    draft.name !== baseline.name ||
    draft.phone !== baseline.phone ||
    draft.group !== baseline.group;

  const performAction = useCallback((action: PendingAction) => {
    if (action.kind === "close") {
      onClose();
      return;
    }
    if (action.kind === "back") {
      setDraft(baseline);
      setShowEditor(false);
      setError(null);
      return;
    }
    if (action.kind === "new") {
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      setBaseline(EMPTY_DRAFT);
      setError(null);
      setShowEditor(true);
      return;
    }
    setEditing(action.contact);
    setDraft(action.contact);
    setBaseline(action.contact);
    setError(null);
    setShowEditor(true);
  }, [baseline, onClose]);

  const requestAction = useCallback((action: PendingAction) => {
    if (isDirty) {
      setPendingAction(action);
    } else {
      performAction(action);
    }
  }, [isDirty, performAction]);

  const requestClose = useCallback(() => {
    requestAction({ kind: "close" });
  }, [requestAction]);

  const requestBackToContacts = useCallback(() => {
    requestAction({ kind: "back" });
  }, [requestAction]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? contacts.filter((contact) =>
          [contact.name, contact.phone, contact.group].some((value) =>
            value.toLowerCase().includes(needle),
          ),
        )
      : contacts;
  }, [contacts, query]);

  const groups = useMemo(() => {
    const result = new Map<string, Contact[]>();
    for (const contact of filtered) {
      const group = contact.group || "Contacts";
      result.set(group, [...(result.get(group) ?? []), contact]);
    }
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function startNew() {
    requestAction({ kind: "new" });
  }

  function startEdit(contact: Contact) {
    requestAction({ kind: "edit", contact });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (syncedContact) {
      if (launchedFromConversation) onClose();
      else setShowEditor(false);
      return;
    }
    const phone = normalizePhone(draft.phone);
    if (!draft.name.trim()) return setError("Enter a contact name.");
    if (!phone) return setError("Enter a valid phone number.");
    const duplicate = contacts.find(
      (contact) => contact.phone === phone && contact.id !== editing?.id,
    );
    if (duplicate) return setError(`${formatPhone(phone)} is already saved as ${duplicate.name}.`);

    setBusy(true);
    setError(null);
    try {
      const savedContact = {
        id: editing?.id ?? crypto.randomUUID(),
        name: draft.name.trim(),
        phone,
        group: draft.group.trim(),
      };
      await saveContact(savedContact);
      setEditing(savedContact);
      setDraft(savedContact);
      setBaseline(savedContact);
      if (launchedFromConversation) {
        onClose();
      } else {
        setShowEditor(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save contact.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || !window.confirm(`Delete ${editing.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteContact(editing.id);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      setBaseline(EMPTY_DRAFT);
      setShowEditor(false);
      if (launchedFromConversation) onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="contacts-backdrop" className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:p-4" onClick={requestClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Contacts"
        className="flex h-dvh w-full max-w-[720px] overflow-hidden shadow-2xl sm:h-[min(680px,90vh)] sm:rounded-[24px]"
        style={{ background: "var(--bg-main)", border: "1px solid var(--hairline)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <section className={`${showEditor ? "hidden sm:flex" : "flex"} w-full flex-col sm:w-[42%] sm:min-w-[250px]`} style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--hairline)" }}>
          <header className="flex min-h-14 items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight">Contacts</h2>
              <p className="text-[11px] text-[color:var(--text-secondary)]">{contacts.length} contacts</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNew} aria-label="Add contact" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-[28px] font-light text-[#0a7aff] transition-colors hover:bg-black/[0.05] active:bg-black/[0.1]">+</button>
              <button onClick={requestClose} aria-label="Close contacts and return to Messages" className="flex min-h-11 items-center justify-center rounded-[10px] px-2 text-[15px] font-semibold text-[#0a7aff] transition-colors hover:bg-black/[0.05] active:bg-black/[0.1]">Close</button>
            </div>
          </header>
          <div className="px-4 pb-3">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" className="w-full rounded-[8px] bg-[color:var(--field)] px-3 py-1.5 text-[13px] outline-none" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-[color:var(--text-secondary)]">{query ? "No contacts found" : "Add a contact to replace phone numbers with names."}</p>
            ) : groups.map(([group, members]) => (
              <div key={group} className="mb-3">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">{group}</p>
                {members.map((contact) => (
                  <button key={contact.id} onClick={() => startEdit(contact)} className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left ${editing?.id === contact.id ? "bg-[#0a7aff] text-white" : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"}`}>
                    <Avatar name={contact.name} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{contact.name}</span>
                      <span className={`block text-[11px] ${editing?.id === contact.id ? "text-white/75" : "text-[color:var(--text-secondary)]"}`}>{formatPhone(contact.phone)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className={`${showEditor ? "flex" : "hidden sm:flex"} min-w-0 flex-1 flex-col`}>
          <header className="grid min-h-14 grid-cols-[1fr_auto_1fr] items-center px-2 pt-[env(safe-area-inset-top)] sm:px-4 sm:pt-0" style={{ borderBottom: "1px solid var(--hairline)" }}>
            <button type="button" onClick={requestBackToContacts} className="flex min-h-11 items-center justify-self-start px-2 text-[15px] text-[#0a7aff] sm:hidden">
              <span aria-hidden className="mr-1 text-[24px] font-light">‹</span> Contacts
            </button>
            <button type="button" onClick={requestClose} className="hidden min-h-11 items-center justify-self-start px-2 text-[15px] text-[#0a7aff] sm:flex">Close</button>
            <h3 className="text-[15px] font-semibold">
              {syncedContact ? "Contact" : editing ? "Edit Contact" : "New Contact"}
            </h3>
            <button type="submit" form="contact-form" disabled={busy} className="min-h-11 justify-self-end px-2 text-[15px] font-semibold text-[#0a7aff] disabled:opacity-50">{busy ? "Saving…" : "Done"}</button>
          </header>
          <form id="contact-form" onSubmit={save} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:p-6">
            <div className="mb-3 flex justify-center"><Avatar name={draft.name} size={92} /></div>
            <p className="mb-6 text-center text-[13px] text-[color:var(--text-secondary)]">{draft.phone ? formatPhone(normalizePhone(draft.phone) || draft.phone) : "Contact information"}</p>
            <label htmlFor="contact-name" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Name</label>
            <input id="contact-name" autoFocus={!syncedContact} readOnly={syncedContact} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Full name or business" className="mb-4 min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none read-only:text-[color:var(--text-secondary)] focus:border-[#0a7aff]" />
            <label htmlFor="contact-phone" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Phone</label>
            <input id="contact-phone" readOnly={syncedContact} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="(555) 123-4567" inputMode="tel" className="mb-4 min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none read-only:text-[color:var(--text-secondary)] focus:border-[#0a7aff]" />
            <label htmlFor="contact-group" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Group <span className="text-[color:var(--text-secondary)]">(optional)</span></label>
            <input id="contact-group" readOnly={syncedContact} value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })} placeholder="Clients, Team, Vendors…" className="min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none read-only:text-[color:var(--text-secondary)] focus:border-[#0a7aff]" />
            {syncedContact && (
              <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
                Synced from People &amp; Agencies. Update the Command Center to
                change this contact.
              </p>
            )}
            {error && <p role="alert" className="mt-3 text-[12px] text-red-500">{error}</p>}
            <div className="mt-auto flex items-center justify-between pt-8">
              {editing && !syncedContact ? <button type="button" onClick={remove} disabled={busy} className="min-h-11 text-[15px] text-red-500 disabled:opacity-50">Delete Contact</button> : <span />}
            </div>
          </form>
        </section>
      </div>
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center"
          onClick={() => setPendingAction(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-contact-title"
            aria-describedby="discard-contact-description"
            className="w-full max-w-[320px] overflow-hidden rounded-[18px] bg-[color:var(--bg-main)] text-center shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 pb-5 pt-6">
              <h3 id="discard-contact-title" className="text-[17px] font-semibold">Unsaved Changes</h3>
              <p id="discard-contact-description" className="mt-1.5 text-[13px] leading-snug text-[color:var(--text-secondary)]">
                Your contact edits haven’t been saved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="min-h-12 w-full border-t border-[color:var(--hairline)] text-[16px] font-semibold text-[#0a7aff]"
            >
              Keep Editing
            </button>
            <button
              type="button"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                performAction(action);
              }}
              className="min-h-12 w-full border-t border-[color:var(--hairline)] text-[16px] text-red-500"
            >
              Discard Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
