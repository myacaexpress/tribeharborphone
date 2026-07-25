/**
 * Typed access to server-side environment variables.
 *
 * Required in production (see README for the setup runbook):
 * - TWILIO_ACCOUNT_SID        Twilio account SID (ACxxxx)
 * - TWILIO_API_KEY_SID        API key SID (SKxxxx) used to mint access tokens
 * - TWILIO_API_KEY_SECRET     API key secret
 * - TWILIO_AUTH_TOKEN         Account auth token (webhook signature validation)
 * - TWILIO_PHONE_NUMBER       Business number in E.164, e.g. +15551234567
 * - TWILIO_TWIML_APP_SID      TwiML App SID (APxxxx) for browser outbound calls
 * - TWILIO_CONVERSATIONS_SERVICE_SID  Conversations service SID (ISxxxx)
 * - SESSION_SECRET            Random string used to sign session cookies
 * - MARIE_PASSWORD            Login password for the single app user
 * - OPENAI_API_KEY            Project key used for support drafting/classifying
 * - MEETING_ALERT_SECRET      Shared secret for the Gmail ingestion monitor
 * - MEETING_SCHEDULER_SERVICE_ACCOUNT  OIDC identity used by Cloud Scheduler
 * - MEETING_STATE_BUCKET      Private GCS bucket for meeting state
 *
 * Optional:
 * - VOICE_FALLBACK_NUMBER     E.164 number to forward inbound calls to when
 *                             the browser client doesn't answer
 * - APP_BASE_URL              Public base URL (needed behind proxies so
 *                             webhook signature validation sees the real URL)
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get twilioAccountSid() {
    return required("TWILIO_ACCOUNT_SID");
  },
  get twilioApiKeySid() {
    return required("TWILIO_API_KEY_SID");
  },
  get twilioApiKeySecret() {
    return required("TWILIO_API_KEY_SECRET");
  },
  get twilioAuthToken() {
    return required("TWILIO_AUTH_TOKEN");
  },
  get twilioPhoneNumber() {
    return required("TWILIO_PHONE_NUMBER");
  },
  get twilioTwimlAppSid() {
    return required("TWILIO_TWIML_APP_SID");
  },
  get twilioConversationsServiceSid() {
    return required("TWILIO_CONVERSATIONS_SERVICE_SID");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get mariePassword() {
    return required("MARIE_PASSWORD");
  },
  get openAiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get openAiModel() {
    return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
  },
  get meetingAlertSecret() {
    return required("MEETING_ALERT_SECRET");
  },
  get meetingSchedulerServiceAccount() {
    return required("MEETING_SCHEDULER_SERVICE_ACCOUNT");
  },
  get meetingStateBucket() {
    return required("MEETING_STATE_BUCKET");
  },
  get voiceFallbackNumber() {
    return process.env.VOICE_FALLBACK_NUMBER ?? null;
  },
  get appBaseUrl() {
    return process.env.APP_BASE_URL ?? null;
  },
};

/** The Twilio Client identity Marie's browser registers as. */
export const CLIENT_IDENTITY = "marie";
