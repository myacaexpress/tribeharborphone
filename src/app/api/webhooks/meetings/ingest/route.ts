import { NextResponse } from "next/server";
import { validateMeetingIngestSecret } from "@/lib/meeting-auth";
import { parseMeetingInvite } from "@/lib/meeting-alerts";
import { ingestMeetingOccurrences } from "@/lib/meeting-messenger";

export const dynamic = "force-dynamic";

const MAX_RAW_MIME_LENGTH = 4_000_000;

export async function POST(request: Request) {
  if (!validateMeetingIngestSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  let sourceMessageId = "";
  let sourceUrl: string | null = null;
  let rawMimeBase64Url = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    sourceMessageId =
      typeof body.sourceMessageId === "string" ? body.sourceMessageId.trim() : "";
    sourceUrl =
      typeof body.sourceUrl === "string" && body.sourceUrl.startsWith("https://")
        ? body.sourceUrl
        : null;
    rawMimeBase64Url =
      typeof body.rawMimeBase64Url === "string" ? body.rawMimeBase64Url : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (
    !sourceMessageId ||
    !rawMimeBase64Url ||
    rawMimeBase64Url.length > MAX_RAW_MIME_LENGTH
  ) {
    return NextResponse.json(
      { error: "sourceMessageId and a bounded rawMimeBase64Url are required" },
      { status: 400 },
    );
  }

  const occurrences = await parseMeetingInvite({
    sourceMessageId,
    sourceUrl,
    rawMimeBase64Url,
  });
  if (occurrences.length === 0) {
    return NextResponse.json(
      { error: "no qualifying meeting invitation found" },
      { status: 422 },
    );
  }

  const result = await ingestMeetingOccurrences(occurrences);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

