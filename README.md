# Tribe Harbor Phone

A browser softphone + messaging app for the Trifecta Benefits business number.
Marie signs in, sees iMessage-style threads (individual and group texts), sends
SMS/MMS from the business number, places outbound calls with the business
caller ID, and answers inbound calls in the browser.

Built with Next.js, Twilio Voice JS SDK (calls), and Twilio Conversations
(messaging + group MMS).

## How it works

- `POST /api/login` — password login, signed session cookie. Everything except
  Twilio webhooks requires the session (enforced in `src/proxy.ts`).
- `GET /api/token` — mints a Twilio access token (Voice + Conversations
  grants) for the browser, identity `marie`.
- `POST /api/voice/outbound` — TwiML App voice URL. Bridges browser calls to
  the dialed number with the business caller ID.
- `POST /api/voice/inbound` — business number's voice URL. Rings the browser
  client; after 20s unanswered, `/api/voice/inbound-status` forwards to
  `VOICE_FALLBACK_NUMBER` or takes a voicemail.
- `POST /api/webhooks/conversations` — Conversations service webhook. When an
  inbound text auto-creates a conversation (including group MMS threads Marie
  is added to), this joins Marie's identity so it appears in her app.
- `POST /api/conversations` — starts a new 1:1 (proxy address) or group MMS
  (projected address) thread.

All Twilio webhook routes validate the `X-Twilio-Signature` header.

## Environment variables

Copy `.env.example` to `.env.local` for local dev (see `src/lib/env.ts` for
the full reference):

| Variable | What it is |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Account SID (`AC…`), Twilio Console home |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | API key (`SK…`) — Console → Account → API keys |
| `TWILIO_AUTH_TOKEN` | Auth token (webhook signature validation) |
| `TWILIO_PHONE_NUMBER` | The business number, E.164 (`+1…`) |
| `TWILIO_TWIML_APP_SID` | TwiML App SID (`AP…`), created below |
| `TWILIO_CONVERSATIONS_SERVICE_SID` | Conversations service SID (`IS…`) |
| `SESSION_SECRET` | Long random string |
| `MARIE_PASSWORD` | Marie's login password |
| `VOICE_FALLBACK_NUMBER` | Optional: forward unanswered inbound calls here |
| `APP_BASE_URL` | Public URL of the deployed app (required in production for signature validation behind the proxy) |

## Twilio console setup (one time)

1. **API key**: Console → Account → API keys & tokens → Create API key.
   Record the SID and secret.
2. **TwiML App**: Console → Voice → TwiML Apps → Create. Set the Voice
   request URL to `https://<app-url>/api/voice/outbound` (POST).
3. **Phone number voice**: Console → Phone Numbers → the business number →
   Voice configuration → "A call comes in" → Webhook
   `https://<app-url>/api/voice/inbound` (POST).
4. **Conversations service**: Console → Conversations → Services. Use the
   default service (or create one) and record its `IS…` SID.
5. **Autocreate conversations for inbound SMS**: Console → Conversations →
   Addresses → add the business number with "Autocreate a Conversation"
   enabled, bound to that service.
6. **Service webhook**: Console → Conversations → Services → (service) →
   Webhooks. Set the post-event URL to
   `https://<app-url>/api/webhooks/conversations` and enable the
   `onConversationAdded` event.
7. **Group MMS**: the business number must be US/Canada MMS-capable. For
   deliverability, confirm the number is registered to an A2P 10DLC campaign
   (Console → Messaging → Regulatory compliance).

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run lint
```

Inbound webhooks need a public URL; use a tunnel (e.g. `ngrok http 3000`) and
point the Twilio URLs and `APP_BASE_URL` at it, or test inbound only on the
deployed app.

`/demo` (behind the same login) renders the real UI with clearly-labeled
synthetic data — useful for design review before credentials exist. Append
`?call=incoming` to preview the incoming-call banner.

## Deploy (Cloud Run)

See [docs/deploy.md](docs/deploy.md) for the full runbook: Secret Manager
setup (no secret values in shell history), the deploy command, setting
`APP_BASE_URL`, and pointing the three console-configured Twilio webhook URLs
(TwiML App voice, number voice, Conversations service webhook) at the service.
The fourth route, `/api/voice/inbound-status`, is reached via a relative TwiML
`action` and never appears in the console.

## Notes

- One login (Marie). Teammates use their regular phones; they appear as SMS
  participants.
- Compliance: this v1 is for internal team communication. Before using it to
  text or call clients/leads, review TCPA / consent / quiet-hours obligations
  and (for Medicare business) CMS marketing rules.
