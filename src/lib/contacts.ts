import { formatPhone } from "./format";

export interface Contact {
  id: string;
  name: string;
  phone: string;
  group: string;
}

export const CONTACTS_ATTRIBUTE = "tribePhoneContacts";

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return "";
}

export function parseContacts(attributes: unknown): Contact[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }
  const raw = (attributes as Record<string, unknown>)[CONTACTS_ATTRIBUTE];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item)),
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      phone: typeof item.phone === "string" ? normalizePhone(item.phone) : "",
      group: typeof item.group === "string" ? item.group.trim() : "",
    }))
    .filter((contact) => contact.id && contact.name && contact.phone)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function contactName(contacts: Contact[], address: string): string | null {
  const phone = normalizePhone(address);
  return contacts.find((contact) => contact.phone === phone)?.name ?? null;
}

export function displayAddress(contacts: Contact[], address: string): string {
  return contactName(contacts, address) ?? formatPhone(address);
}

export function resolveConversationName(
  friendlyName: string | null,
  contacts: Contact[],
): string {
  if (!friendlyName) return "Conversation";
  const parts = friendlyName.split(",").map((part) => part.trim());
  const allPhoneNumbers = parts.every((part) => Boolean(normalizePhone(part)));
  if (!allPhoneNumbers) return friendlyName;
  return parts.map((part) => displayAddress(contacts, part)).join(", ");
}
