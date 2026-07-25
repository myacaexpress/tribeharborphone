import { NextResponse } from "next/server";
import { generateSupportDraft } from "@/lib/support-ai";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let actionId = "";
  try {
    const body = (await request.json()) as { actionId?: unknown };
    actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!/^ACT-[A-Z0-9-]+$/i.test(actionId)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  try {
    const workspace = await getWorkspace();
    const action = workspace.actions.find((item) => item.id === actionId);
    if (!action) {
      return NextResponse.json({ error: "Action not found." }, { status: 404 });
    }
    const message = await generateSupportDraft(action);
    return NextResponse.json(
      { message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Could not generate support draft",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Could not draft a message right now. Please try again." },
      { status: 503 },
    );
  }
}

