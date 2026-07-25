import { NextResponse } from "next/server";
import { validateMeetingScheduler } from "@/lib/meeting-auth";
import { sendDueMeetingReminders } from "@/lib/meeting-messenger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await validateMeetingScheduler(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await sendDueMeetingReminders(), {
    headers: { "Cache-Control": "no-store" },
  });
}

