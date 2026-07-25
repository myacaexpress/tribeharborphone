import { NextResponse } from "next/server";
import { CLIENT_IDENTITY, env } from "@/lib/env";
import { restClient } from "@/lib/twilio-server";

const MAX_GROUP_RECIPIENTS = 9;

function normalizeE164(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-.]/g, "");
  if (/^\+[0-9]{8,15}$/.test(cleaned)) return cleaned;
  // Assume US 10-digit numbers.
  if (/^[0-9]{10}$/.test(cleaned)) return `+1${cleaned}`;
  if (/^1[0-9]{10}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

/**
 * Create a new thread (auth enforced by middleware).
 * Body: { addresses: string[], friendlyName?: string }
 *
 * 1:1 threads bind the peer with proxyAddress = business number.
 * Group threads atomically create:
 * - one Chat participant (Marie) projected as the business number
 * - two or more native SMS participants, each bound only by their own number
 *
 * That is Twilio's Group MMS model. A projected address represents the
 * in-app participant; it must not be assigned to every SMS recipient.
 */
export async function POST(request: Request) {
  let addresses: string[] = [];
  let friendlyName: string | undefined;
  try {
    const body = await request.json();
    if (Array.isArray(body.addresses)) {
      addresses = body.addresses.filter((a: unknown) => typeof a === "string");
    }
    if (typeof body.friendlyName === "string" && body.friendlyName.trim()) {
      friendlyName = body.friendlyName.trim();
    }
  } catch {
    // handled below
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    const e164 = normalizeE164(raw);
    if (!e164) {
      return NextResponse.json(
        { error: `Invalid phone number: ${raw}` },
        { status: 400 },
      );
    }
    if (!seen.has(e164)) {
      seen.add(e164);
      normalized.push(e164);
    }
  }
  if (normalized.length === 0) {
    return NextResponse.json(
      { error: "At least one phone number is required" },
      { status: 400 },
    );
  }
  if (normalized.includes(env.twilioPhoneNumber)) {
    return NextResponse.json(
      { error: "The Tribe Phone number cannot be one of its own recipients" },
      { status: 400 },
    );
  }
  if (normalized.length > MAX_GROUP_RECIPIENTS) {
    return NextResponse.json(
      {
        error: `A group can include up to ${MAX_GROUP_RECIPIENTS} recipients`,
      },
      { status: 400 },
    );
  }

  const client = restClient();
  const service = client.conversations.v1.services(
    env.twilioConversationsServiceSid,
  );

  if (normalized.length > 1) {
    if (
      !env.twilioPhoneNumber.startsWith("+1") ||
      normalized.some((address) => !address.startsWith("+1"))
    ) {
      return NextResponse.json(
        { error: "Native group MMS requires US or Canadian (+1) numbers" },
        { status: 400 },
      );
    }

    try {
      const conversation = await service.conversationWithParticipants.create({
        friendlyName: friendlyName ?? normalized.join(", "),
        participant: [
          JSON.stringify({
            identity: CLIENT_IDENTITY,
            messaging_binding: {
              projected_address: env.twilioPhoneNumber,
            },
          }),
          ...normalized.map((address) =>
            JSON.stringify({ messaging_binding: { address } }),
          ),
        ],
      });
      return NextResponse.json({
        sid: conversation.sid,
        state: conversation.state,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not create the group";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  const conversation = await service.conversations.create({
    friendlyName: friendlyName ?? normalized.join(", "),
  });

  try {
    await service
      .conversations(conversation.sid)
      .participants.create({
        "messagingBinding.address": normalized[0],
        "messagingBinding.proxyAddress": env.twilioPhoneNumber,
      });
    await service
      .conversations(conversation.sid)
      .participants.create({ identity: CLIENT_IDENTITY });
  } catch (error) {
    // Clean up the half-built conversation so retries start fresh
    // (e.g. the peer number is already bound to another 1:1 thread).
    await service.conversations(conversation.sid).remove();
    const message =
      error instanceof Error ? error.message : "Failed to add participants";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ sid: conversation.sid });
}
