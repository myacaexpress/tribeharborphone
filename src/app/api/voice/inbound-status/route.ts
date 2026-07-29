import { after } from "next/server";
import twilio from "twilio";
import { env } from "@/lib/env";
import { sendPhoneNotification } from "@/lib/push-notifications";
import { formParams, validateTwilioSignature } from "@/lib/twilio-server";

/**
 * Dial action for inbound calls. If Marie answered, the call is done.
 * Otherwise: forward to the fallback number if configured, else voicemail.
 */
export async function POST(request: Request) {
  const params = await formParams(request);
  if (!validateTwilioSignature(request, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const twiml = new twilio.twiml.VoiceResponse();
  const status = params.DialCallStatus ?? "";

  if (status !== "completed" && status !== "answered") {
    after(() =>
      sendPhoneNotification({
        title: "Missed Tribe Phone call",
        body: "Nobody answered the business line. Tap to open Tribe Phone.",
        tag: `missed-call-${params.CallSid ?? Date.now()}`,
      }),
    );
    if (env.voiceRingGroupNumbers.length === 0 && env.voiceFallbackNumber) {
      const dial = twiml.dial({ answerOnBridge: true });
      dial.number(env.voiceFallbackNumber);
    } else {
      twiml.say(
        "You have reached Trifecta Benefits. We are unable to take your call right now. Please leave a message after the tone.",
      );
      twiml.record({ maxLength: 120, playBeep: true });
    }
  }

  return new Response(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
