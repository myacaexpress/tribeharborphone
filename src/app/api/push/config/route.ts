import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    enabled: env.webPushConfigured,
    publicKey: env.webPushVapidPublicKey,
  });
}
