import { NextResponse } from "next/server";
import { normalizePhone, type Contact } from "@/lib/contacts";
import { CLIENT_IDENTITY, env } from "@/lib/env";
import { generateConversationDraft } from "@/lib/support-ai";
import {
  findSupportedActionContext,
  type SupportedActionContext,
} from "@/lib/support-policy";
import { restClient } from "@/lib/twilio-server";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function participantAddress(binding: unknown): string {
  if (!binding || typeof binding !== "object") return "";
  const values = binding as Record<string, unknown>;
  const address = values.address ?? values.Address;
  return typeof address === "string" ? normalizePhone(address) : "";
}

export async function POST(request: Request) {
  let conversationSid = "";
  let currentDraft = "";
  try {
    const body = (await request.json()) as {
      conversationSid?: unknown;
      currentDraft?: unknown;
    };
    conversationSid =
      typeof body.conversationSid === "string"
        ? body.conversationSid.trim()
        : "";
    currentDraft =
      typeof body.currentDraft === "string"
        ? body.currentDraft.trim().slice(0, 1_000)
        : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!/^CH[a-f0-9]{32}$/i.test(conversationSid)) {
    return NextResponse.json(
      { error: "Invalid conversation." },
      { status: 400 },
    );
  }

  try {
    const workspace = await getWorkspace();
    const conversation = restClient().conversations.v1
      .services(env.twilioConversationsServiceSid)
      .conversations(conversationSid);
    const [messagesDescending, participants] = await Promise.all([
      conversation.messages.list({ order: "desc", limit: 20 }),
      conversation.participants.list({ limit: 50 }),
    ]);

    const candidatePhones = [
      ...messagesDescending.map((message) =>
        normalizePhone(message.author ?? ""),
      ),
      ...participants.map((participant) =>
        participantAddress(participant.messagingBinding),
      ),
    ].filter(Boolean);

    let supported: SupportedActionContext | null = null;
    for (const phone of candidatePhones) {
      supported = findSupportedActionContext(phone, workspace);
      if (supported) break;
    }

    let contact: Contact | null = supported?.contact ?? null;
    if (!contact) {
      for (const phone of candidatePhones) {
        contact =
          workspace.contacts.find((item) => item.phone === phone) ?? null;
        if (contact) break;
      }
    }

    const contactPhone = contact?.phone ?? "";
    const recentMessages = [...messagesDescending]
      .reverse()
      .filter((message) => Boolean(message.body?.trim()))
      .slice(-12)
      .map((message) => {
        const authorPhone = normalizePhone(message.author ?? "");
        return {
          speaker:
            message.author === CLIENT_IDENTITY
              ? ("tribe_support" as const)
              : contactPhone && authorPhone === contactPhone
                ? ("supported_contact" as const)
                : ("group_participant" as const),
          text: (message.body ?? "").trim().slice(0, 1_000),
        };
      });

    if (recentMessages.length === 0 && !supported) {
      return NextResponse.json(
        { error: "There is not enough conversation context to draft a reply." },
        { status: 422 },
      );
    }

    const message = await generateConversationDraft({
      contactName: contact?.name ?? null,
      action: supported?.action ?? null,
      recentMessages,
      currentDraft,
    });
    return NextResponse.json(
      {
        message,
        context: {
          usedOpenAction: Boolean(supported),
          usedConversationMessages: recentMessages.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not generate conversation draft", {
      conversationSid,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json(
      { error: "Could not draft a reply right now. Please try again." },
      { status: 503 },
    );
  }
}

