import { GoogleAuth } from "google-auth-library";
import { env } from "./env";
import {
  emptyScheduledMessageState,
  type ScheduledMessageState,
} from "./scheduled-messages";

const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const STATE_OBJECT = "scheduled-messages/state.json";

type StoredState = {
  generation: string | null;
  state: ScheduledMessageState;
};

async function authorizationHeaders(): Promise<Record<string, string>> {
  const auth = new GoogleAuth({ scopes: [STORAGE_SCOPE] });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  return Object.fromEntries(headers.entries());
}

function metadataUrl(): string {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.meetingStateBucket)}/o/${encodeURIComponent(STATE_OBJECT)}`;
}

async function readState(): Promise<StoredState> {
  const headers = await authorizationHeaders();
  const metadataResponse = await fetch(metadataUrl(), { headers });
  if (metadataResponse.status === 404) {
    return { generation: null, state: emptyScheduledMessageState() };
  }
  if (!metadataResponse.ok) {
    throw new Error(
      `Scheduled message state metadata failed (${metadataResponse.status})`,
    );
  }
  const metadata = (await metadataResponse.json()) as { generation?: string };
  const contentResponse = await fetch(`${metadataUrl()}?alt=media`, { headers });
  if (!contentResponse.ok) {
    throw new Error(
      `Scheduled message state read failed (${contentResponse.status})`,
    );
  }
  const candidate = (await contentResponse.json()) as Partial<ScheduledMessageState>;
  const state =
    candidate.version === 1 &&
    candidate.messages &&
    typeof candidate.messages === "object" &&
    !Array.isArray(candidate.messages)
      ? {
          version: 1 as const,
          messages: candidate.messages,
          updatedAt:
            typeof candidate.updatedAt === "string"
              ? candidate.updatedAt
              : new Date(0).toISOString(),
        }
      : emptyScheduledMessageState();
  return { generation: metadata.generation ?? null, state };
}

async function writeState(
  state: ScheduledMessageState,
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
    throw new Error(
      `Scheduled message state write failed (${response.status})`,
    );
  }
  return true;
}

export async function getScheduledMessageState(): Promise<ScheduledMessageState> {
  return (await readState()).state;
}

export async function updateScheduledMessageState(
  mutate: (state: ScheduledMessageState) => ScheduledMessageState,
): Promise<ScheduledMessageState> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readState();
    const next = mutate(current.state);
    if (await writeState(next, current.generation)) return next;
  }
  throw new Error("Scheduled messages changed too often; retry the request.");
}

