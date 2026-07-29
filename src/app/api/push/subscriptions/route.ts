import { NextResponse } from "next/server";
import {
  deletePushSubscription,
  savePushSubscription,
} from "@/lib/push-subscriptions";

export async function POST(request: Request) {
  const saved = await savePushSubscription(await request.json());
  if (!saved) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const candidate = (await request.json()) as { endpoint?: unknown };
  if (typeof candidate.endpoint !== "string") {
    return NextResponse.json({ error: "invalid endpoint" }, { status: 400 });
  }
  await deletePushSubscription(candidate.endpoint);
  return NextResponse.json({ ok: true });
}
