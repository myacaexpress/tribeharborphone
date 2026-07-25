import { normalizePhone, type Contact } from "./contacts";
import type { WorkspaceAction, WorkspacePayload } from "./workspace";

export type SupportIntent =
  | "help_request"
  | "status_update"
  | "comment"
  | "thanks"
  | "opt_out"
  | "other";

export interface SupportClassification {
  intent: SupportIntent;
  confidence: number;
  directlyAboutAction: boolean;
}

export interface SupportedActionContext {
  contact: Contact;
  action: WorkspaceAction;
}

function comparableName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function firstName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^test\s*[—–-]\s*(?:agent\s+)?/i, "");
  return cleaned.split(/\s+/)[0] || "there";
}

export function findSupportedActionContext(
  author: string,
  workspace: WorkspacePayload,
): SupportedActionContext | null {
  const phone = normalizePhone(author);
  if (!phone) return null;

  const contact = workspace.contacts.find((item) => item.phone === phone);
  if (!contact) return null;

  const contactName = comparableName(contact.name);
  const action = workspace.actions.find(
    (item) => comparableName(item.affectedRecord) === contactName,
  );
  return action ? { contact, action } : null;
}

export function isOptOutMessage(body: string): boolean {
  return /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(body.trim());
}

export function shouldAutoAcknowledge(
  classification: SupportClassification,
): boolean {
  return (
    classification.intent === "help_request" &&
    classification.confidence >= 0.86 &&
    classification.directlyAboutAction
  );
}

export function actionOwnerLabel(owner: string): string {
  const trimmed = owner.trim();
  if (!trimmed || /^individual agent$/i.test(trimmed)) {
    return "our support team";
  }
  if (/^sab$/i.test(trimmed)) return "the SAB team";
  return trimmed;
}

export function supportAcknowledgement(
  contactName: string,
  owner: string,
): string {
  const name = firstName(contactName);
  const introduction = /^anika$/i.test(name)
    ? "Hi Anika — TriBe Support here."
    : `Hi ${name}, Anika with TriBe Support here.`;
  return `${introduction} I’ll check with ${actionOwnerLabel(owner)} on that and follow up here.`;
}
