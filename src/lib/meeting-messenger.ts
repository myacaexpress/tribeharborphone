import { CLIENT_IDENTITY, env } from "./env";
import {
  MEETING_TEAM,
  type MeetingOccurrence,
  type MeetingTeamMember,
  attendeeStatusFor,
  isMeetingTeamMemberInvited,
  localMeetingTime,
  mergeMeetingOccurrences,
} from "./meeting-alerts";
import {
  getMeetingState,
  pruneMeetingState,
  updateMeetingState,
} from "./meeting-state";
import { parseContacts, type Contact } from "./contacts";
import { restClient } from "./twilio-server";

type Delivery = {
  member: MeetingTeamMember;
  phone: string;
  status: "sent" | "already_sent";
};

type TeamContact = {
  member: MeetingTeamMember;
  contact: Contact;
};

function parseAttributes(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function memberForName(name: string): MeetingTeamMember | null {
  const normalized = name.trim().toLowerCase();
  for (const member of MEETING_TEAM) {
    if (
      normalized === member.toLowerCase() ||
      normalized.startsWith(`${member.toLowerCase()} `)
    ) {
      return member;
    }
  }
  return null;
}

async function loadUserState(): Promise<{
  contacts: TeamContact[];
  missing: MeetingTeamMember[];
}> {
  const user = await restClient()
    .conversations.v1.services(env.twilioConversationsServiceSid)
    .users(CLIENT_IDENTITY)
    .fetch();
  const attributes = parseAttributes(user.attributes);
  const byMember = new Map<MeetingTeamMember, Contact>();
  for (const contact of parseContacts(attributes)) {
    const member = memberForName(contact.name);
    if (member && !byMember.has(member)) byMember.set(member, contact);
  }
  const contacts = MEETING_TEAM.flatMap((member) => {
    const contact = byMember.get(member);
    return contact ? [{ member, contact }] : [];
  });
  return {
    contacts,
    missing: MEETING_TEAM.filter((member) => !byMember.has(member)),
  };
}

function participantPhone(binding: unknown): string | null {
  if (!binding || typeof binding !== "object") return null;
  const value = binding as Record<string, unknown>;
  const address = value.address ?? value.Address;
  return typeof address === "string" ? address : null;
}

async function directConversation(phone: string) {
  const service = restClient().conversations.v1.services(
    env.twilioConversationsServiceSid,
  );
  const conversations = await service.conversations.list({ limit: 100 });
  for (const item of conversations) {
    const conversation = service.conversations(item.sid);
    const participants = await conversation.participants.list({ limit: 20 });
    const external = participants
      .map((participant) => participantPhone(participant.messagingBinding))
      .filter((address): address is string => Boolean(address));
    if (external.length === 1 && external[0] === phone) return conversation;
  }

  const created = await service.conversations.create({ friendlyName: phone });
  const conversation = service.conversations(created.sid);
  try {
    await conversation.participants.create({
      "messagingBinding.address": phone,
      "messagingBinding.proxyAddress": env.twilioPhoneNumber,
    });
    await conversation.participants.create({ identity: CLIENT_IDENTITY });
  } catch (error) {
    await conversation.remove();
    throw error;
  }
  return conversation;
}

function alreadySent(attributes: string | null, key: string): boolean {
  const parsed = parseAttributes(attributes);
  return parsed.meeting_alert_key === key;
}

async function sendOnce(
  phone: string,
  body: string,
  key: string,
): Promise<"sent" | "already_sent"> {
  const conversation = await directConversation(phone);
  const recent = await conversation.messages.list({ order: "desc", limit: 100 });
  if (recent.some((message) => alreadySent(message.attributes, key))) {
    return "already_sent";
  }
  await conversation.messages.create({
    author: CLIENT_IDENTITY,
    body,
    attributes: JSON.stringify({
      meeting_alert_key: key,
      tribe_meeting_alert: true,
      version: 1,
    }),
  });
  return "sent";
}

function invitationLink(
  event: MeetingOccurrence,
  member: MeetingTeamMember,
): string {
  if (member === "Shawn" && event.shawnResponseUrl) {
    return event.shawnResponseUrl;
  }
  return "https://calendar.google.com/calendar/u/0/r";
}

function invitationBody(
  event: MeetingOccurrence,
  member: MeetingTeamMember,
): string {
  const status = attendeeStatusFor(event, member);
  const prompt =
    status === "ACCEPTED"
      ? "You’re already marked as attending."
      : "Please open Google Calendar and confirm you’re going.";
  return [
    `Meeting invite: ${event.title}`,
    localMeetingTime(event.startAt, member),
    prompt,
    invitationLink(event, member),
  ].join("\n");
}

function reminderBody(
  event: MeetingOccurrence,
  member: MeetingTeamMember,
): string {
  const link = event.meetUrl ?? event.eventUrl ?? event.sourceUrl;
  return [
    `In 15 minutes: ${event.title}`,
    localMeetingTime(event.startAt, member),
    link ? `Join: ${link}` : "Open your calendar for the meeting details.",
  ].join("\n");
}

export async function ingestMeetingOccurrences(
  occurrences: MeetingOccurrence[],
  now = new Date(),
): Promise<{
  stored: number;
  deliveries: Delivery[];
  missing: MeetingTeamMember[];
}> {
  const user = await loadUserState();
  await updateMeetingState((state) =>
    mergeMeetingOccurrences(state, occurrences, now),
  );

  const nextBySource = new Map<string, MeetingOccurrence>();
  for (const event of occurrences) {
    if (event.cancelled || Date.parse(event.startAt) < now.getTime()) continue;
    const current = nextBySource.get(event.sourceMessageId);
    if (!current || event.startAt < current.startAt) {
      nextBySource.set(event.sourceMessageId, event);
    }
  }

  const deliveries: Delivery[] = [];
  for (const event of nextBySource.values()) {
    for (const { member, contact } of user.contacts) {
      if (!isMeetingTeamMemberInvited(event, member)) continue;
      const key = `meeting-invite:${event.sourceMessageId}:${contact.phone}`;
      deliveries.push({
        member,
        phone: contact.phone,
        status: await sendOnce(
          contact.phone,
          invitationBody(event, member),
          key,
        ),
      });
    }
  }
  return { stored: occurrences.length, deliveries, missing: user.missing };
}

export async function sendDueMeetingReminders(
  now = new Date(),
): Promise<{
  due: number;
  deliveries: Delivery[];
  missing: MeetingTeamMember[];
}> {
  const user = await loadUserState();
  const state = await getMeetingState();
  const due = Object.values(state.events).filter((event) => {
    if (event.cancelled) return false;
    const untilStart = Date.parse(event.startAt) - now.getTime();
    return untilStart > 0 && untilStart <= 16 * 60_000;
  });
  const deliveries: Delivery[] = [];
  for (const event of due) {
    for (const { member, contact } of user.contacts) {
      if (!isMeetingTeamMemberInvited(event, member)) continue;
      const key = `meeting-reminder:${event.id}:${contact.phone}`;
      deliveries.push({
        member,
        phone: contact.phone,
        status: await sendOnce(
          contact.phone,
          reminderBody(event, member),
          key,
        ),
      });
    }
  }
  await pruneMeetingState(now);
  return { due: due.length, deliveries, missing: user.missing };
}
