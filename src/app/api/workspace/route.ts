import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getWorkspace(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Workspace sync failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workspace sync failed." },
      { status: 503 },
    );
  }
}
