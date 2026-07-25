import { simpleParser } from "mailparser";
import ical, {
  type Attendee,
  type Organizer,
  type VEvent,
} from "node-ical";

export const MEETING_ALERTS_ATTRIBUTE = "tribeMeetingAlerts";
export const MEETING_TEAM = ["Shawn", "Michael", "Mark"] as const;

export type MeetingTeamMember = (typeof MEETING_TEAM)[number];

export type MeetingAttendee = {
  email: string;
  name: string | null;
  status:
    | "NEEDS-ACTION"
    | "ACCEPTED"
    | "DECLINED"
    | "TENTATIVE"
    | "DELEGATED"
    | null;
};

export type MeetingOccurrence = {
  id: string;
  uid: string;
  sourceMessageId: string;
  sourceUrl: string | null;
  title: string;
  startAt: string;
  endAt: string;
  originalTimeZone: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: MeetingAttendee[];
  meetUrl: string | null;
  eventUrl: string | null;
  shawnResponseUrl: string | null;
  cancelled: boolean;
};

export type MeetingAlertState = {
  version: 1;
  events: Record<string, MeetingOccurrence>;
  updatedAt: string;
};

const EMPTY_STATE: MeetingAlertState = {
  version: 1,
  events: {},
  updatedAt: new Date(0).toISOString(),
};

const TEAM_EMAILS = new Set([
  "myacaexpress@gmail.com",
  "shawn@tribeharbor.com",
  "mark@tribeharbor.com",
  "markfernandez9504@gmail.com",
  "michael@tribeharbor.com",
  "pro.mentum.solutions@gmail.com",
  "marie@tribeharbor.com",
]);

function parameterValue(
  value: string | { val: string; params?: unknown } | undefined,
): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.val;
}

function calendarAddress(value: Attendee | Organizer): string {
  const raw = parameterValue(value).trim();
  return raw.replace(/^mailto:/i, "").toLowerCase();
}

function attendeeValue(value: Attendee): MeetingAttendee {
  if (typeof value === "string") {
    return { email: calendarAddress(value), name: null, status: null };
  }
  return {
    email: calendarAddress(value),
    name: typeof value.params.CN === "string" ? value.params.CN : null,
    status: value.params.PARTSTAT ?? null,
  };
}

function organizerValue(value: Organizer | undefined): {
  email: string | null;
  name: string | null;
} {
  if (!value) return { email: null, name: null };
  if (typeof value === "string") {
    return { email: calendarAddress(value), name: null };
  }
  return {
    email: calendarAddress(value),
    name: typeof value.params.CN === "string" ? value.params.CN : null,
  };
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');
}

function firstUrl(
  text: string,
  patterns: RegExp[],
): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function meetingUrl(text: string): string | null {
  return firstUrl(text, [
    /(https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^"'<>\s)]*)?)/i,
    /(https:\/\/[\w.-]*zoom\.us\/j\/[^\s"'<>)]*)/i,
    /(https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>)]*)/i,
  ]);
}

function eventViewUrl(text: string): string | null {
  return firstUrl(text, [
    /(https:\/\/calendar\.google\.com\/calendar\/event\?action=VIEW[^"'<>\s)]*)/i,
  ]);
}

function shawnYesUrl(text: string): string | null {
  return firstUrl(text, [
    /(https:\/\/calendar\.google\.com\/calendar\/event\?action=RESPOND[^"'<>\s)]*?(?:&|&amp;)rst=1[^"'<>\s)]*)/i,
  ]);
}

function eventAttendees(event: VEvent): MeetingAttendee[] {
  if (!event.attendee) return [];
  const attendees = Array.isArray(event.attendee)
    ? event.attendee
    : [event.attendee];
  return attendees
    .map(attendeeValue)
    .filter((attendee) => attendee.email);
}

function isTeamMeeting(
  event: VEvent,
  subject: string,
  body: string,
): boolean {
  const attendeeEmails = eventAttendees(event).map((item) => item.email);
  const hasTeamAttendee = attendeeEmails.some((email) => TEAM_EMAILS.has(email));
  const haystack = `${subject}\n${parameterValue(event.summary)}\n${parameterValue(event.description)}\n${body}`;
  return hasTeamAttendee || /\bSAB\b|TriBe|Trifecta/i.test(haystack);
}

function eventEnd(event: VEvent): Date {
  if (event.end instanceof Date) return event.end;
  return new Date(event.start.getTime() + 30 * 60_000);
}

function occurrences(
  event: VEvent,
  from: Date,
  to: Date,
): Array<{ start: Date; end: Date }> {
  if (!event.rrule) {
    return event.start <= to && eventEnd(event) >= from
      ? [{ start: event.start, end: eventEnd(event) }]
      : [];
  }
  return ical
    .expandRecurringEvent(event, {
      from,
      to,
      includeOverrides: true,
      excludeExdates: true,
      expandOngoing: false,
    })
    .map((instance) => ({ start: instance.start, end: instance.end }));
}

function parseStateCandidate(value: unknown): MeetingAlertState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(EMPTY_STATE);
  }
  const candidate = value as Partial<MeetingAlertState>;
  if (
    candidate.version !== 1 ||
    !candidate.events ||
    typeof candidate.events !== "object" ||
    Array.isArray(candidate.events)
  ) {
    return structuredClone(EMPTY_STATE);
  }
  return {
    version: 1,
    events: candidate.events,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date(0).toISOString(),
  };
}

export function parseMeetingAlertState(attributes: unknown): MeetingAlertState {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return structuredClone(EMPTY_STATE);
  }
  return parseStateCandidate(
    (attributes as Record<string, unknown>)[MEETING_ALERTS_ATTRIBUTE],
  );
}

export function mergeMeetingOccurrences(
  current: MeetingAlertState,
  incoming: MeetingOccurrence[],
  now = new Date(),
): MeetingAlertState {
  const earliestKept = now.getTime() - 7 * 24 * 60 * 60_000;
  const events = Object.fromEntries(
    Object.entries(current.events).filter(
      ([, event]) => Date.parse(event.endAt) >= earliestKept,
    ),
  );
  for (const event of incoming) events[event.id] = event;
  return {
    version: 1,
    events,
    updatedAt: now.toISOString(),
  };
}

export async function parseMeetingInvite({
  sourceMessageId,
  sourceUrl,
  rawMimeBase64Url,
  now = new Date(),
  horizonDays = 60,
}: {
  sourceMessageId: string;
  sourceUrl?: string | null;
  rawMimeBase64Url: string;
  now?: Date;
  horizonDays?: number;
}): Promise<MeetingOccurrence[]> {
  const raw = Buffer.from(
    rawMimeBase64Url.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
  const mail = await simpleParser(raw);
  const subject = mail.subject?.trim() ?? "Meeting";
  const body = [
    mail.text ?? "",
    typeof mail.html === "string" ? mail.html : "",
  ].join("\n");
  const calendarAttachments = mail.attachments.filter(
    (attachment) =>
      attachment.contentType === "text/calendar" ||
      attachment.filename?.toLowerCase().endsWith(".ics"),
  );
  const from = new Date(now.getTime() - 24 * 60 * 60_000);
  const to = new Date(now.getTime() + horizonDays * 24 * 60 * 60_000);
  const parsed: MeetingOccurrence[] = [];

  for (const attachment of calendarAttachments) {
    const calendar = ical.sync.parseICS(attachment.content.toString("utf8"));
    for (const component of Object.values(calendar)) {
      if (!component || component.type !== "VEVENT") continue;
      const event = component as VEvent;
      if (!isTeamMeeting(event, subject, body)) continue;
      const attendees = eventAttendees(event);
      const organizer = organizerValue(event.organizer);
      const title = parameterValue(event.summary).trim() || subject;
      const description = parameterValue(event.description);
      const location = parameterValue(event.location);
      const linkSource = `${body}\n${description}\n${location}\n${event.url ?? ""}`;
      const meetUrl = meetingUrl(linkSource);
      const eventUrl = eventViewUrl(body) ?? event.url ?? null;
      const responseUrl = shawnYesUrl(body);
      const cancelled =
        event.status === "CANCELLED" ||
        event.method === "CANCEL" ||
        calendar.vcalendar?.method === "CANCEL";

      for (const instance of occurrences(event, from, to)) {
        const startAt = instance.start.toISOString();
        parsed.push({
          id: `${event.uid}:${startAt}`,
          uid: event.uid,
          sourceMessageId,
          sourceUrl: sourceUrl ?? null,
          title,
          startAt,
          endAt: instance.end.toISOString(),
          originalTimeZone:
            typeof event.start.tz === "string" ? event.start.tz : null,
          organizerEmail: organizer.email,
          organizerName: organizer.name,
          attendees,
          meetUrl,
          eventUrl,
          shawnResponseUrl: responseUrl,
          cancelled,
        });
      }
    }
  }

  return parsed.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export const TEAM_TIME_ZONES: Record<MeetingTeamMember, string> = {
  Shawn: "America/Los_Angeles",
  Michael: "America/Chicago",
  Mark: "America/New_York",
};

function timeZoneShortName(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? "";
}

export function localMeetingTime(
  startAt: string,
  member: MeetingTeamMember,
): string {
  const date = new Date(startAt);
  const timeZone = TEAM_TIME_ZONES[member];
  const dateAndTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${dateAndTime} ${timeZoneShortName(date, timeZone)}`.trim();
}

export function attendeeStatusFor(
  event: MeetingOccurrence,
  member: MeetingTeamMember,
): MeetingAttendee["status"] {
  const aliases: Record<MeetingTeamMember, string[]> = {
    Shawn: ["myacaexpress@gmail.com", "shawn@tribeharbor.com"],
    Michael: ["pro.mentum.solutions@gmail.com", "michael@tribeharbor.com"],
    Mark: ["markfernandez9504@gmail.com", "mark@tribeharbor.com"],
  };
  return (
    event.attendees.find((attendee) =>
      aliases[member].includes(attendee.email.toLowerCase()),
    )?.status ?? null
  );
}
