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
| `TWILIO_PHONE_NUMBER` | (kept in ignored `.env.local`) | Confirmed in Twilio account; Voice+SMS+MMS. Inbound SMS is bound to Conversations autocreation (the number-level demo SMS URL is cleared), and inbound Voice points to Cloud Run. |
| `TWILIO_API_KEY_SID` | (kept in ignored `.env.local`) | Dedicated Standard key "Tribe Harbor Phone 2026-07-19" |
| `TWILIO_API_KEY_SECRET` | (Secret Manager `tribeharborphone-twilio-api-key-secret`, v2 ENABLED) | Rotated and verified against Conversations + Voice |
| `TWILIO_ACCOUNT_SID` | (kept in ignored `.env.local`) | Confirmed 2026-07-18 |
| `TWILIO_CONVERSATIONS_SERVICE_SID` | (kept in ignored `.env.local`) | Confirmed 2026-07-18 (Default Conversations Service) |
| `SESSION_SECRET` | (Secret Manager `tribeharborphone-session-secret`, v1 ENABLED) | Generated securely, never in chat/repo |
| `MARIE_PASSWORD` | (Secret Manager `tribeharborphone-marie-password`, v1 ENABLED) | Generated securely, never in chat/repo |
| `TWILIO_AUTH_TOKEN` | (Secret Manager `tribeharborphone-twilio-auth-token`, v1 ENABLED) | Bound to Cloud Run for webhook signature validation |
| `OPENAI_API_KEY` | (Secret Manager `tribeharborphone-openai-api-key`) | Project-scoped key for support drafts and inbound help-request classification |
| `MEETING_ALERT_SECRET` | (Secret Manager `tribeharborphone-meeting-alert-secret`) | Authenticates the Gmail invite ingestion monitor |
| `MEETING_SCHEDULER_SERVICE_ACCOUNT` | `tribeharborphone-scheduler@tribe-wayfinder-dev.iam.gserviceaccount.com` | OIDC identity accepted by the reminder endpoint |
| `MEETING_STATE_BUCKET` | `tribe-wayfinder-dev-phone-state` | Private durable state for parsed meeting occurrences |
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
         tribeharborphone-marie-password \
         tribeharborphone-openai-api-key \
         tribeharborphone-meeting-alert-secret; do
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
  --set-env-vars "TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID},TWILIO_API_KEY_SID=${TWILIO_API_KEY_SID},TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER},TWILIO_TWIML_APP_SID=${TWILIO_TWIML_APP_SID},TWILIO_CONVERSATIONS_SERVICE_SID=${TWILIO_CONVERSATIONS_SERVICE_SID},OPENAI_MODEL=gpt-5.6-terra,MEETING_SCHEDULER_SERVICE_ACCOUNT=tribeharborphone-scheduler@${PROJECT}.iam.gserviceaccount.com,MEETING_STATE_BUCKET=tribe-wayfinder-dev-phone-state" \
  --set-secrets "TWILIO_API_KEY_SECRET=tribeharborphone-twilio-api-key-secret:latest,TWILIO_AUTH_TOKEN=tribeharborphone-twilio-auth-token:latest,SESSION_SECRET=tribeharborphone-session-secret:latest,MARIE_PASSWORD=tribeharborphone-marie-password:latest,OPENAI_API_KEY=tribeharborphone-openai-api-key:latest,MEETING_ALERT_SECRET=tribeharborphone-meeting-alert-secret:latest"
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

### Connect the Command Center sheet

Share the Command Center spreadsheet as **Editor** with the runtime service
account from step 2. Then set only its spreadsheet ID:

```bash
gcloud run services update tribeharborphone \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars \
  "GOOGLE_SHEETS_SPREADSHEET_ID=1q5zh2W_grgsnwhcl-giRcHDHTTmdBBKYCN9uqMQVZII"
```

The app reads **People & Agencies** and **Open Actions**. Completing an action
updates that row and appends a phone-originated audit event to **Activity Log**.
Google Application Default Credentials use the Cloud Run service identity; no
service-account key file is stored in the app.

### Meeting invitation and reminder pipeline

Meeting invitation email is read from `myacaexpress@gmail.com` by a narrow
Gmail monitor. The monitor posts the original MIME message to
`/api/webhooks/meetings/ingest`; the server parses the attached iCalendar data,
expands recurring meetings, and stores only the resulting event metadata in the
private `tribe-wayfinder-dev-phone-state` bucket.

The invitation notification is deduplicated by Gmail message id and recipient.
The reminder notification is deduplicated by calendar event occurrence and
recipient. Team phone numbers come from the phone app's saved contacts, using
names that begin with `Shawn`, `Michael`, or `Mark`; no CRM is required.

Cloud Scheduler calls `/api/webhooks/meetings/reminders` every minute using an
OIDC token from `tribeharborphone-scheduler@tribe-wayfinder-dev.iam.gserviceaccount.com`.
That protected tick delivers both due meeting reminders and user-created
scheduled messages. Scheduled messages are stored in the same private state
bucket under a separate object and are claimed before delivery so scheduler
retries cannot knowingly send the same message twice. The server formats one
absolute meeting instant in each recipient's local timezone:

- Shawn: `America/Los_Angeles`
- Michael: `America/Chicago`
- Mark: `America/New_York`

The scheduler endpoint rejects shared secrets and accepts only that verified
service-account identity. The ingestion endpoint uses the separate
`MEETING_ALERT_SECRET`; neither endpoint accepts a browser session as
authorization.

Create the minute-by-minute reminder trigger after deployment. The OIDC
audience must exactly match the configured `APP_BASE_URL`:

```bash
export BASE_URL=https://tribeharborphone-618590726026.us-central1.run.app
export SCHEDULER_SA=tribeharborphone-scheduler@${PROJECT}.iam.gserviceaccount.com

gcloud scheduler jobs create http tribeharborphone-meeting-reminders \
  --project "$PROJECT" --location "$REGION" \
  --schedule='* * * * *' --time-zone=Etc/UTC \
  --http-method=POST \
  --uri="${BASE_URL}/api/webhooks/meetings/reminders" \
  --oidc-service-account-email="$SCHEDULER_SA" \
  --oidc-token-audience="$BASE_URL" \
  --attempt-deadline=30s
```

## 5. Map the mobile-friendly domain

The preferred user-facing URL is `https://phone.tribeharbor.com`. Keep
`APP_BASE_URL` on the Cloud Run service URL until the Twilio webhook URLs are
deliberately migrated together, and set
`PUBLIC_APP_URL=https://phone.tribeharbor.com` for browser login redirects.
This keeps the canonical browser URL independent from webhook signature
validation.

1. Verify `tribeharbor.com` for the Google account that owns the Cloud Run
   project:

   ```bash
   gcloud domains verify tribeharbor.com --project "$PROJECT"
   ```

2. Create the Cloud Run mapping:

   ```bash
   gcloud beta run domain-mappings create \
     --service tribeharborphone \
     --domain phone.tribeharbor.com \
     --project "$PROJECT" \
     --region "$REGION"
   ```

3. Add only the DNS record returned by the mapping command (normally a
   `phone` CNAME). Do not change the apex, `www`, MX, SPF, DKIM, or Proton
   records.
4. Wait for the managed certificate:

   ```bash
   gcloud beta run domain-mappings describe \
     --domain phone.tribeharbor.com \
     --project "$PROJECT" \
     --region "$REGION"
   ```

The original `${SERVICE_URL}` remains a working fallback during DNS and
certificate propagation.

## 6. Point Twilio at the service

Production was configured and API-verified on 2026-07-19. The required state
is listed here for recovery or a future environment migration.

Using `${SERVICE_URL}` from step 4, set the **three** console-configured
webhook URLs:

1. TwiML App → Voice request URL: `${SERVICE_URL}/api/voice/outbound` (POST)
2. Business number → Voice → "A call comes in":
   `${SERVICE_URL}/api/voice/inbound` (POST)
3. Conversations service → Webhooks → post-event URL:
   `${SERVICE_URL}/api/webhooks/conversations`, with the
   `onConversationAdded`, `onConversationStateUpdated`, and `onMessageAdded`
   events enabled

(The fourth route, `/api/voice/inbound-status`, is reached via a relative
TwiML `action` and is never configured in the console.)

Also confirm, same console session:

- Conversations → Addresses: the business number is bound to the service with
  "Autocreate a Conversation" enabled.
- Messaging → Regulatory compliance: the number is registered to an A2P 10DLC
  campaign (deliverability).

The business number's ordinary Programmable Messaging webhook must be empty.
Twilio invokes a number-level webhook even when Conversations captures the
message; leaving the stock demo URL there causes an unwanted automatic reply
in addition to delivering the inbound message to Tribe Phone.

## 7. Smoke test

1. Open `https://phone.tribeharbor.com` (or `${SERVICE_URL}` during DNS
   propagation), sign in as Marie, and install it from the browser menu.
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
