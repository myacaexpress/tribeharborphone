import { env } from "@/lib/env";
import { restClient } from "@/lib/twilio-server";

export const dynamic = "force-dynamic";

type HealthResult = {
  checkedAt: string;
  service: "tribe-phone";
  status: "ok" | "degraded";
  twilio: {
    conversations: "ok" | "error";
    credentials: "ok" | "error";
    voice: "ok" | "error";
  };
};

/**
 * Public, non-secret readiness signal for Tribe Harbor integrations.
 * A 200 means the runtime credential can reach both required Twilio products;
 * a 503 means the app is serving but should not be launched for live use.
 */
export async function GET() {
  const twilio: HealthResult["twilio"] = {
    conversations: "error",
    credentials: "error",
    voice: "error",
  };

  try {
    const client = restClient();
    const [service, application] = await Promise.allSettled([
      client.conversations.v1
        .services(env.twilioConversationsServiceSid)
        .fetch(),
      client.applications(env.twilioTwimlAppSid).fetch(),
    ]);
    twilio.conversations = service.status === "fulfilled" ? "ok" : "error";
    twilio.voice = application.status === "fulfilled" ? "ok" : "error";
    // Standard API keys intentionally cannot read the Accounts endpoint. A
    // successful call to either product proves that the credential itself is
    // accepted; the individual resource checks still gate overall readiness.
    twilio.credentials =
      service.status === "fulfilled" || application.status === "fulfilled"
        ? "ok"
        : "error";
  } catch {
    // Keep the response intentionally coarse: callers need readiness, not
    // credential details or upstream error messages.
  }

  const status = Object.values(twilio).every((value) => value === "ok")
    ? "ok"
    : "degraded";
  const body: HealthResult = {
    checkedAt: new Date().toISOString(),
    service: "tribe-phone",
    status,
    twilio,
  };

  return Response.json(body, {
    status: status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
