"use client";

import { useMemo, useState } from "react";
import { formatPhone } from "@/lib/format";
import { normalizePhone, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { useTwilio } from "./TwilioProvider";

const EMPTY_DRAFT = { id: "", name: "", phone: "", group: "" };

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
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null>(initialContact);
  const [draft, setDraft] = useState(
    initialContact ?? { ...EMPTY_DRAFT, phone: normalizedInitialPhone },
  );
  const [showEditor, setShowEditor] = useState(Boolean(normalizedInitialPhone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setShowEditor(true);
  }

  function startEdit(contact: Contact) {
    setEditing(contact);
    setDraft(contact);
    setError(null);
    setShowEditor(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      setShowEditor(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:p-4" onClick={onClose}>
      <div
        className="flex h-dvh w-full max-w-[720px] overflow-hidden shadow-2xl sm:h-[min(680px,90vh)] sm:rounded-[24px]"
        style={{ background: "var(--bg-main)", border: "1px solid var(--hairline)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <section className={`${showEditor ? "hidden sm:flex" : "flex"} w-full flex-col sm:w-[42%] sm:min-w-[250px]`} style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--hairline)" }}>
          <header className="flex min-h-14 items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight">Contacts</h2>
              <p className="text-[11px] text-[color:var(--text-secondary)]">{contacts.length} saved</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNew} aria-label="Add contact" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-[28px] font-light text-[#0a7aff] transition-colors hover:bg-black/[0.05] active:bg-black/[0.1]">+</button>
              <button onClick={onClose} aria-label="Close contacts" className="flex h-11 w-11 items-center justify-center rounded-full text-[24px] text-[color:var(--text-secondary)] sm:hidden">×</button>
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
            <button type="button" onClick={() => setShowEditor(false)} className="flex min-h-11 items-center justify-self-start px-2 text-[15px] text-[#0a7aff] sm:hidden">
              <span aria-hidden className="mr-1 text-[24px] font-light">‹</span> Contacts
            </button>
            <button type="button" onClick={onClose} className="hidden min-h-11 items-center justify-self-start px-2 text-[15px] text-[#0a7aff] sm:flex">Cancel</button>
            <h3 className="text-[15px] font-semibold">{editing ? "Edit Contact" : "New Contact"}</h3>
            <button type="submit" form="contact-form" disabled={busy} className="min-h-11 justify-self-end px-2 text-[15px] font-semibold text-[#0a7aff] disabled:opacity-50">{busy ? "Saving…" : "Done"}</button>
          </header>
          <form id="contact-form" onSubmit={save} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:p-6">
            <div className="mb-3 flex justify-center"><Avatar name={draft.name} size={92} /></div>
            <p className="mb-6 text-center text-[13px] text-[color:var(--text-secondary)]">{draft.phone ? formatPhone(normalizePhone(draft.phone) || draft.phone) : "Contact information"}</p>
            <label htmlFor="contact-name" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Name</label>
            <input id="contact-name" autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Full name or business" className="mb-4 min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none focus:border-[#0a7aff]" />
            <label htmlFor="contact-phone" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Phone</label>
            <input id="contact-phone" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="(555) 123-4567" inputMode="tel" className="mb-4 min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none focus:border-[#0a7aff]" />
            <label htmlFor="contact-group" className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Group <span className="text-[color:var(--text-secondary)]">(optional)</span></label>
            <input id="contact-group" value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })} placeholder="Clients, Team, Vendors…" className="min-h-11 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[16px] outline-none focus:border-[#0a7aff]" />
            {error && <p role="alert" className="mt-3 text-[12px] text-red-500">{error}</p>}
            <div className="mt-auto flex items-center justify-between pt-8">
              {editing ? <button type="button" onClick={remove} disabled={busy} className="min-h-11 text-[15px] text-red-500 disabled:opacity-50">Delete Contact</button> : <span />}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
