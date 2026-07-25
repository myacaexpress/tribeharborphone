import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function validateMeetingIngestSecret(request: Request): boolean {
  const provided = request.headers.get("x-tribe-meeting-secret") ?? "";
  return Boolean(provided) && safeEqual(provided, env.meetingAlertSecret);
}

export async function validateMeetingScheduler(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const audience = env.appBaseUrl;
  if (!audience) return false;
  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: authorization.slice("Bearer ".length),
      audience,
    });
    const payload = ticket.getPayload();
    return (
      payload?.email === env.meetingSchedulerServiceAccount &&
      payload.email_verified === true
    );
  } catch {
    return false;
  }
}
