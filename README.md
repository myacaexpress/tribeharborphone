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
  is added to), this joins Marie's identity so it appears in her app. For an
  exact phone-number match to the affected agent on an open action, it also
  classifies inbound messages and sends a short acknowledgment only for a
  high-confidence request for help with that action.
- `POST /api/ai/support-draft` — produces an editable outreach preview from
  the selected open action. It never sends the preview automatically.
- `POST /api/conversations` — starts a new 1:1 (proxy address) or group MMS
  (projected address) thread.
- `GET /api/workspace` — syncs phone contacts from **People & Agencies** and
  open follow-ups from **Open Actions** in the Command Center sheet.
- `PATCH /api/workspace/actions/:id` — completes a phone action in the sheet
  and appends the change to **Activity Log**.

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
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Command Center spreadsheet ID. The Cloud Run runtime service account must have Editor access. |
| `OPENAI_API_KEY` | OpenAI project key for support drafts and guarded inbound classification |
| `OPENAI_MODEL` | Optional low-latency support model; defaults to `gpt-5.6-terra` |

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
   `onConversationAdded`, `onConversationStateUpdated`, and `onMessageAdded`
   events. The state event lets the app join inbound Group MMS threads after
   Twilio finishes their asynchronous initialization; the message event powers
   the guarded support acknowledgment.
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

## Install on a phone

The app is an installable PWA at `https://phone.tribeharbor.com` (the Cloud
Run URL remains a fallback).

- **iPhone/iPad:** open the site in Safari, tap Share, then **Add to Home
  Screen**.
- **Android:** open the site in Chrome, open the browser menu, then tap
  **Install app** or **Add to Home screen**.

The installed app opens in its own full-screen window and keeps the existing
login and live Twilio behavior. Messages and private API responses are never
stored by the service worker; when offline, the app shows a simple reconnect
screen.

## Command Center on the phone

Contacts with a phone number in **People & Agencies** appear automatically in
the contact picker. **Open Actions** appears directly below Messages; tapping
an action opens its details and can produce an editable support-message
preview; the preview is review-only and must be copied/sent by a person.
Tapping the circle marks an action complete, records the completion metadata,
and adds an append-only row to **Activity Log**. Sheet-synced contacts remain
read-only in the phone app so the spreadsheet stays the source of truth.

For inbound group messages, the app first requires an exact phone match to the
affected contact on an open action. It ignores internal participants, ordinary
comments, progress updates, thanks, and opt-outs. Only a high-confidence,
action-related help request receives the deterministic acknowledgment:
Anika will check with the action owner and follow up in the thread. The model
classifies intent; it does not invent the recipient or response.

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
