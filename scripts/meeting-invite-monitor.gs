// Tribe Harbor Phone meeting invite monitor.
// Copy this file into the Apps Script project that owns the minute trigger.
// Store the endpoint credential in Script Properties as TRIBE_MEETING_SECRET.
//
// A rolling lookback prevents future meetings from being skipped when the
// monitor is installed after the invitation arrives. Message IDs provide
// deduplication, so the lookback does not resend already handled invitations.
function ingestMeetingInvites() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("TRIBE_MEETING_SECRET");
  if (!secret) throw new Error("TRIBE_MEETING_SECRET is not configured");

  const endpoint =
    "https://tribeharborphone-618590726026.us-central1.run.app/api/webhooks/meetings/ingest";
  const processedKey = "meetingProcessedMessageIds";
  const processed = new Set(
    JSON.parse(props.getProperty(processedKey) || "[]"),
  );
  const threads = GmailApp.search(
    "newer_than:60d filename:ics -in:spam -in:trash",
    0,
    500,
  );
  const failures = [];
  const newlyProcessed = [];

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const messageId = message.getId();
      if (processed.has(messageId)) return;

      const attachments = message.getAttachments({
        includeInlineImages: false,
      });
      const hasCalendarInvite = attachments.some((attachment) => {
        const contentType = attachment.getContentType().toLowerCase();
        const name = attachment.getName().toLowerCase();
        return contentType.includes("text/calendar") || name.endsWith(".ics");
      });
      if (!hasCalendarInvite) return;

      const raw = message.getRawContent();
      const response = UrlFetchApp.fetch(endpoint, {
        method: "post",
        contentType: "application/json",
        headers: { "x-tribe-meeting-secret": secret },
        payload: JSON.stringify({
          sourceMessageId: messageId,
          sourceUrl:
            "https://mail.google.com/mail/u/0/#all/" + thread.getId(),
          rawMimeBase64Url: Utilities.base64EncodeWebSafe(
            Utilities.newBlob(raw).getBytes(),
          ),
        }),
        muteHttpExceptions: true,
      });

      const status = response.getResponseCode();
      if ((status >= 200 && status < 300) || status === 422) {
        processed.add(messageId);
        newlyProcessed.push(messageId);
      } else {
        failures.push(
          messageId +
            ": HTTP " +
            status +
            " " +
            response.getContentText(),
        );
      }
    });
  });

  // Remain below Apps Script's per-property value limit while retaining enough
  // history for the bounded search window.
  const retained = Array.from(processed).slice(-350);
  props.setProperty(processedKey, JSON.stringify(retained));
  props.setProperty("meetingLastRunMs", String(Date.now()));

  console.log(
    "Meeting monitor processed " +
      newlyProcessed.length +
      " new invite messages.",
  );
  if (failures.length) throw new Error(failures.join("\n"));
}
