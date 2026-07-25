import { GoogleAuth } from "google-auth-library";
import {
  type MeetingAlertState,
  mergeMeetingOccurrences,
} from "./meeting-alerts";
import { env } from "./env";

const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const STATE_OBJECT = "meeting-alerts/state.json";

type StoredState = {
  generation: string | null;
  state: MeetingAlertState;
};

const emptyState = (): MeetingAlertState => ({
  version: 1,
  events: {},
  updatedAt: new Date(0).toISOString(),
});

async function authorizationHeaders(): Promise<Record<string, string>> {
  const auth = new GoogleAuth({ scopes: [STORAGE_SCOPE] });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function metadataUrl(): string {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.meetingStateBucket)}/o/${encodeURIComponent(STATE_OBJECT)}`;
}

async function readState(): Promise<StoredState> {
  const headers = await authorizationHeaders();
  const metadataResponse = await fetch(metadataUrl(), { headers });
  if (metadataResponse.status === 404) {
    return { generation: null, state: emptyState() };
  }
  if (!metadataResponse.ok) {
    throw new Error(`Meeting state metadata failed (${metadataResponse.status})`);
  }
  const metadata = (await metadataResponse.json()) as { generation?: string };
  const contentResponse = await fetch(`${metadataUrl()}?alt=media`, { headers });
  if (!contentResponse.ok) {
    throw new Error(`Meeting state read failed (${contentResponse.status})`);
  }
  const candidate = (await contentResponse.json()) as Partial<MeetingAlertState>;
  const state =
    candidate.version === 1 &&
    candidate.events &&
    typeof candidate.events === "object" &&
    !Array.isArray(candidate.events)
      ? {
          version: 1 as const,
          events: candidate.events,
          updatedAt:
            typeof candidate.updatedAt === "string"
              ? candidate.updatedAt
              : new Date(0).toISOString(),
        }
      : emptyState();
  return { generation: metadata.generation ?? null, state };
}

async function writeState(
  state: MeetingAlertState,
  generation: string | null,
): Promise<boolean> {
  const headers = await authorizationHeaders();
  const query = new URLSearchParams({
    uploadType: "media",
    name: STATE_OBJECT,
    ifGenerationMatch: generation ?? "0",
  });
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.meetingStateBucket)}/o?${query}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    },
  );
  if (response.status === 412) return false;
  if (!response.ok) {
    throw new Error(`Meeting state write failed (${response.status})`);
  }
  return true;
}

export async function getMeetingState(): Promise<MeetingAlertState> {
  return (await readState()).state;
}

export async function updateMeetingState(
  mutate: (state: MeetingAlertState) => MeetingAlertState,
): Promise<MeetingAlertState> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readState();
    const next = mutate(current.state);
    if (await writeState(next, current.generation)) return next;
  }
  throw new Error("Meeting state changed too often; retry the request.");
}

export async function pruneMeetingState(
  now = new Date(),
): Promise<MeetingAlertState> {
  return updateMeetingState((state) => mergeMeetingOccurrences(state, [], now));
}

