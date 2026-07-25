import { NextResponse } from "next/server";
import { validateMeetingScheduler } from "@/lib/meeting-auth";
import { synchronizeSabMirror } from "@/lib/sab-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await validateMeetingScheduler(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  try {
    return NextResponse.json(await synchronizeSabMirror(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "SAB read-only synchronization failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "SAB synchronization failed." },
      { status: 502 },
    );
  }
}
