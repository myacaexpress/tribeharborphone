"use client";

import { useMemo, useState } from "react";
import { formatPhone } from "@/lib/format";
import { normalizePhone, type Contact } from "@/lib/contacts";
import Avatar from "./Avatar";
import { useTwilio } from "./TwilioProvider";

const EMPTY_DRAFT = { id: "", name: "", phone: "", group: "" };

export default function ContactsModal({ onClose }: { onClose: () => void }) {
  const { contacts, saveContact, deleteContact } = useTwilio();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
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
  }

  function startEdit(contact: Contact) {
    setEditing(contact);
    setDraft(contact);
    setError(null);
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
      await saveContact({
        id: editing?.id ?? crypto.randomUUID(),
        name: draft.name.trim(),
        phone,
        group: draft.group.trim(),
      });
      setEditing(null);
      setDraft(EMPTY_DRAFT);
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
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-[min(680px,90vh)] w-full max-w-[720px] overflow-hidden rounded-[24px] shadow-2xl"
        style={{ background: "var(--bg-main)", border: "1px solid var(--hairline)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <section className="flex w-[42%] min-w-[250px] flex-col" style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--hairline)" }}>
          <header className="flex items-center justify-between px-4 pb-3 pt-4">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight">Contacts</h2>
              <p className="text-[11px] text-[color:var(--text-secondary)]">{contacts.length} saved</p>
            </div>
            <button onClick={startNew} aria-label="Add contact" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0a7aff] text-xl font-light text-white">+</button>
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

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--hairline)" }}>
            <h3 className="text-[15px] font-semibold">{editing ? "Edit Contact" : "New Contact"}</h3>
            <button onClick={onClose} aria-label="Close contacts" className="rounded-full px-2 py-1 text-[18px] text-[color:var(--text-secondary)] hover:bg-black/[0.05]">×</button>
          </header>
          <form onSubmit={save} className="flex flex-1 flex-col p-6">
            <div className="mb-6 flex justify-center"><Avatar name={draft.name} size={76} /></div>
            <label className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Name</label>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Full name or business" className="mb-4 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[14px] outline-none focus:border-[#0a7aff]" />
            <label className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Phone</label>
            <input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="(555) 123-4567" inputMode="tel" className="mb-4 rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[14px] outline-none focus:border-[#0a7aff]" />
            <label className="mb-1 text-[12px] text-[color:var(--text-secondary)]">Group <span className="text-[color:var(--text-secondary)]">(optional)</span></label>
            <input value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })} placeholder="Clients, Team, Vendors…" className="rounded-[10px] border border-[color:var(--hairline)] bg-transparent px-3 py-2.5 text-[14px] outline-none focus:border-[#0a7aff]" />
            {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}
            <div className="mt-auto flex items-center justify-between pt-6">
              {editing ? <button type="button" onClick={remove} disabled={busy} className="text-[13px] text-red-500 disabled:opacity-50">Delete Contact</button> : <span />}
              <button type="submit" disabled={busy} className="rounded-[10px] bg-[#0a7aff] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
