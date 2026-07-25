import assert from "node:assert/strict";
import test from "node:test";
import {
  attendeeStatusFor,
  isMeetingTeamMemberInvited,
  localMeetingTime,
  parseMeetingInvite,
} from "./meeting-alerts";

function rawInvite(ics: string): string {
  const boundary = "tribe-calendar-boundary";
  const mime = [
    "From: Michael Kisak <pro.mentum.solutions@gmail.com>",
    "To: shawn@tribeharbor.com, mark@tribeharbor.com, michael@tribeharbor.com",
    "Subject: Invitation: TriBe Hump Day Huddle",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    [
      '<a href="https://meet.google.com/xkh-vrcd-wap?hs=224">Join</a>',
      '<a href="https://calendar.google.com/calendar/event?action=VIEW&amp;eid=event123">View</a>',
      '<a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=event123&amp;rst=1">Yes</a>',
    ].join(""),
    `--${boundary}`,
    'Content-Type: text/calendar; charset=utf-8; name="invite.ics"',
    "Content-Transfer-Encoding: 8bit",
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    ics,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

test("parses and expands a recurring team invitation deterministically", async () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:tribe-huddle-1",
    "DTSTAMP:20260724T140000Z",
    "DTSTART;TZID=America/Chicago:20260724T100000",
    "DTEND;TZID=America/Chicago:20260724T101500",
    "RRULE:FREQ=WEEKLY;COUNT=4",
    "SUMMARY:TriBe Hump Day Huddle",
    "ORGANIZER;CN=Michael Kisak:mailto:pro.mentum.solutions@gmail.com",
    "ATTENDEE;CN=Shawn Milner;PARTSTAT=NEEDS-ACTION:mailto:shawn@tribeharbor.com",
    "ATTENDEE;CN=Michael Kisak;PARTSTAT=ACCEPTED:mailto:michael@tribeharbor.com",
    "ATTENDEE;CN=Mark Fernandez;PARTSTAT=TENTATIVE:mailto:mark@tribeharbor.com",
    "LOCATION:https://meet.google.com/xkh-vrcd-wap",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = await parseMeetingInvite({
    sourceMessageId: "gmail-123",
    sourceUrl: "https://mail.google.com/mail/#all/gmail-123",
    rawMimeBase64Url: rawInvite(ics),
    now: new Date("2026-07-24T12:00:00Z"),
    horizonDays: 30,
  });

  assert.equal(events.length, 4);
  assert.equal(events[0].id, "tribe-huddle-1:2026-07-24T15:00:00.000Z");
  assert.equal(events[0].meetUrl, "https://meet.google.com/xkh-vrcd-wap?hs=224");
  assert.match(events[0].eventUrl ?? "", /action=VIEW/);
  assert.match(events[0].shawnResponseUrl ?? "", /rst=1/);
  assert.equal(attendeeStatusFor(events[0], "Shawn"), "NEEDS-ACTION");
  assert.equal(attendeeStatusFor(events[0], "Michael"), "ACCEPTED");
  assert.equal(attendeeStatusFor(events[0], "Mark"), "TENTATIVE");
});

test("formats one instant in each team member's local timezone", () => {
  const start = "2026-07-29T15:00:00.000Z";
  assert.match(localMeetingTime(start, "Shawn"), /8:00 AM PDT/);
  assert.match(localMeetingTime(start, "Michael"), /10:00 AM CDT/);
  assert.match(localMeetingTime(start, "Mark"), /11:00 AM EDT/);
});

test("targets only invited team members and treats the organizer as attending", () => {
  const baseEvent = {
    id: "meeting-1:2026-07-29T15:00:00.000Z",
    uid: "meeting-1",
    sourceMessageId: "gmail-456",
    sourceUrl: null,
    title: "Private Shawn meeting",
    startAt: "2026-07-29T15:00:00.000Z",
    endAt: "2026-07-29T15:30:00.000Z",
    originalTimeZone: "America/Los_Angeles",
    organizerEmail: "external@example.com",
    organizerName: "External Organizer",
    attendees: [
      {
        email: "myacaexpress@gmail.com",
        name: "Shawn Milner",
        status: "NEEDS-ACTION" as const,
      },
      {
        email: "mark@tribeharbor.com",
        name: "Mark Fernandez",
        status: "DECLINED" as const,
      },
    ],
    meetUrl: "https://meet.google.com/abc-defg-hij",
    eventUrl: null,
    shawnResponseUrl: null,
    cancelled: false,
  };

  assert.equal(isMeetingTeamMemberInvited(baseEvent, "Shawn"), true);
  assert.equal(isMeetingTeamMemberInvited(baseEvent, "Michael"), false);
  assert.equal(isMeetingTeamMemberInvited(baseEvent, "Mark"), false);

  const shawnOrganizer = {
    ...baseEvent,
    organizerEmail: "shawnmilner8@gmail.com",
    attendees: [],
  };
  assert.equal(attendeeStatusFor(shawnOrganizer, "Shawn"), "ACCEPTED");
  assert.equal(isMeetingTeamMemberInvited(shawnOrganizer, "Shawn"), true);
  assert.equal(isMeetingTeamMemberInvited(shawnOrganizer, "Michael"), false);
  assert.equal(isMeetingTeamMemberInvited(shawnOrganizer, "Mark"), false);
});
