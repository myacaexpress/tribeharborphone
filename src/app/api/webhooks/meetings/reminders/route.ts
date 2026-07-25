import { NextResponse } from "next/server";
import { validateMeetingScheduler } from "@/lib/meeting-auth";
import { sendDueMeetingReminders } from "@/lib/meeting-messenger";
import { sendDueScheduledMessages } from "@/lib/scheduled-message-dispatch";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await validateMeetingScheduler(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  const [meetings, scheduledMessages] = await Promise.all([
    sendDueMeetingReminders(),
    sendDueScheduledMessages(),
  ]);
  return NextResponse.json({ meetings, scheduledMessages }, {
    headers: { "Cache-Control": "no-store" },
  });
}
