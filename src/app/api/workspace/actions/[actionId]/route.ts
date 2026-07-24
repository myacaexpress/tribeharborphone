import { NextResponse } from "next/server";
import { updateWorkspaceAction } from "@/lib/workspace";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await context.params;
    const body = await request.json() as { status?: unknown };
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }
    await updateWorkspaceAction(actionId, body.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Workspace action update failed", error);
    const message = error instanceof Error ? error.message : "Action update failed.";
    const status = message === "Action not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
