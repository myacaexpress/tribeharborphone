import twilio from "twilio";
import { CLIENT_IDENTITY, env } from "@/lib/env";
import { formParams, validateTwilioSignature } from "@/lib/twilio-server";

/**
 * Voice URL of the business phone number. Rings Marie's browser; if she
 * doesn't answer within the timeout, control passes to the action URL
 * (/api/voice/inbound-status) for fallback handling.
 */
export async function POST(request: Request) {
  const params = await formParams(request);
  if (!validateTwilioSignature(request, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({
    timeout: 20,
    action: "/api/voice/inbound-status",
    answerOnBridge: true,
  });
  dial.client(CLIENT_IDENTITY);
  for (const phoneNumber of env.voiceRingGroupNumbers) {
    dial.number(phoneNumber);
  }

  return new Response(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
