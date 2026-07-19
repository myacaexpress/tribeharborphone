# Deploying Tribe Harbor Phone to Cloud Run

All commands are written so **no secret value ever appears in a command line
or shell history** — secret input is interactive (`read -s`) or generated and
piped. Run everything from the repository root.

Set once per shell:

```bash
export PROJECT=tribe-wayfinder-dev     # confirm this is the intended project
export REGION=us-central1
```

## Confirmed values (2026-07-19)

| Variable | Value | Status |
| --- | --- | --- |
| `TWILIO_PHONE_NUMBER` | (kept in ignored `.env.local`) | Confirmed in Twilio account; Voice+SMS+MMS. Friendly name is a stale "Wayfinder Training Dev" label; webhooks still point at Twilio demo URLs until step 5. |
| `TWILIO_API_KEY_SID` | (kept in ignored `.env.local`) | Dedicated Standard key "Tribe Harbor Phone 2026-07-19" |
| `TWILIO_API_KEY_SECRET` | (Secret Manager `tribeharborphone-twilio-api-key-secret`, v2 ENABLED) | Rotated and verified against Conversations + Voice |
| `TWILIO_ACCOUNT_SID` | (kept in ignored `.env.local`) | Confirmed 2026-07-18 |
| `TWILIO_CONVERSATIONS_SERVICE_SID` | (kept in ignored `.env.local`) | Confirmed 2026-07-18 (Default Conversations Service) |
| `SESSION_SECRET` | (Secret Manager `tribeharborphone-session-secret`, v1 ENABLED) | Generated securely, never in chat/repo |
| `MARIE_PASSWORD` | (Secret Manager `tribeharborphone-marie-password`, v1 ENABLED) | Generated securely, never in chat/repo |
| `TWILIO_AUTH_TOKEN` | (Secret Manager `tribeharborphone-twilio-auth-token`, v1 ENABLED) | Bound to Cloud Run for webhook signature validation |
| `TWILIO_TWIML_APP_SID` | (kept in ignored `.env.local`) | Existing "Tribe Harbor Phone" app; outbound Voice URL points to Cloud Run |

## 1. Secrets (status as of 2026-07-19)

All four secrets exist in `$PROJECT` and have enabled versions. The API-key
secret is at v2; the auth token, session secret, and Marie password are at v1.
For a future auth-token rotation, add a new version without echoing the value
or putting it in shell history:

```bash
read -rs -p "twilio auth token: " V && printf '%s' "$V" | \
  gcloud secrets versions add tribeharborphone-twilio-auth-token \
    --project "$PROJECT" --data-file=- ; unset V; echo
```

## 2. Grant the runtime service account access (one time)

Use the service account the Cloud Run service will run as (default compute SA
unless you choose a dedicated one):

```bash
export RUNTIME_SA="$(gcloud iam service-accounts list --project "$PROJECT" \
  --filter 'displayName:Compute Engine default' --format 'value(email)')"

for s in tribeharborphone-twilio-api-key-secret \
         tribeharborphone-twilio-auth-token \
         tribeharborphone-session-secret \
         tribeharborphone-marie-password; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
    --member "serviceAccount:${RUNTIME_SA}" \
    --role roles/secretmanager.secretAccessor
done
```

## 3. First deploy

Load the five Twilio identifiers into shell variables without committing them
to the repository. `APP_BASE_URL` is intentionally absent — you don't know the
URL yet.

```bash
gcloud run deploy tribeharborphone --source . \
  --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 2 \
  --set-env-vars "TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID},TWILIO_API_KEY_SID=${TWILIO_API_KEY_SID},TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER},TWILIO_TWIML_APP_SID=${TWILIO_TWIML_APP_SID},TWILIO_CONVERSATIONS_SERVICE_SID=${TWILIO_CONVERSATIONS_SERVICE_SID}" \
  --set-secrets "TWILIO_API_KEY_SECRET=tribeharborphone-twilio-api-key-secret:latest,TWILIO_AUTH_TOKEN=tribeharborphone-twilio-auth-token:latest,SESSION_SECRET=tribeharborphone-session-secret:latest,MARIE_PASSWORD=tribeharborphone-marie-password:latest"
```

## 4. Set APP_BASE_URL

```bash
export SERVICE_URL="$(gcloud run services describe tribeharborphone \
  --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"

gcloud run services update tribeharborphone --project "$PROJECT" --region "$REGION" \
  --update-env-vars "APP_BASE_URL=${SERVICE_URL}"
echo "$SERVICE_URL"
```

`APP_BASE_URL` is required in production: Twilio signs webhooks against the
public URL, and behind the Cloud Run proxy the app cannot reconstruct it
reliably on its own. Without it, all webhooks fail signature validation
(fail closed).

## 5. Point Twilio at the service (console, user-only)

Using `${SERVICE_URL}` from step 4, set the **three** console-configured
webhook URLs:

1. TwiML App → Voice request URL: `${SERVICE_URL}/api/voice/outbound` (POST)
2. Business number → Voice → "A call comes in":
   `${SERVICE_URL}/api/voice/inbound` (POST)
3. Conversations service → Webhooks → post-event URL:
   `${SERVICE_URL}/api/webhooks/conversations`, with the
   `onConversationAdded` event enabled

(The fourth route, `/api/voice/inbound-status`, is reached via a relative
TwiML `action` and is never configured in the console.)

Also confirm, same console session:

- Conversations → Addresses: the business number is bound to the service with
  "Autocreate a Conversation" enabled.
- Messaging → Regulatory compliance: the number is registered to an A2P 10DLC
  campaign (deliverability).

## 6. Smoke test

1. Open `${SERVICE_URL}`, sign in as Marie.
2. Send a text to a team phone; reply from the phone; confirm the thread
   updates.
3. Dial a team phone from the dialer; confirm caller ID shows the business
   number.
4. Call the business number from a phone; confirm the browser rings, and
   that not answering hits the fallback (forward or voicemail).

## Notes

- Builds use Cloud Buildpacks (`--source .`); `package.json#engines` pins
  Node ≥ 22 and `next start` honors Cloud Run's `PORT`.
- `.gcloudignore` explicitly excludes `.env*` from source uploads.
- Rotating a secret: add a new version, then redeploy (or
  `gcloud run services update ...` to pick up `:latest`).
