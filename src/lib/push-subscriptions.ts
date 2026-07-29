import { GoogleAuth } from "google-auth-library";
import type { PushSubscription } from "web-push";
import { env } from "./env";

const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const STATE_OBJECT = "tribe-phone/push-subscriptions.json";

type PushState = {
  version: 1;
  subscriptions: Record<
    string,
    { subscription: PushSubscription; updatedAt: string }
  >;
};

type StoredState = {
  generation: string | null;
  state: PushState;
};

const emptyState = (): PushState => ({
  version: 1,
  subscriptions: {},
});

async function authorizationHeaders(): Promise<Record<string, string>> {
  const auth = new GoogleAuth({ scopes: [STORAGE_SCOPE] });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  return Object.fromEntries(headers.entries());
}

function metadataUrl(): string {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.meetingStateBucket)}/o/${encodeURIComponent(STATE_OBJECT)}`;
}

function validSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PushSubscription>;
  return Boolean(
    typeof candidate.endpoint === "string" &&
      candidate.endpoint.startsWith("https://") &&
      candidate.keys &&
      typeof candidate.keys.p256dh === "string" &&
      typeof candidate.keys.auth === "string",
  );
}

async function readState(): Promise<StoredState> {
  const headers = await authorizationHeaders();
  const metadataResponse = await fetch(metadataUrl(), { headers });
  if (metadataResponse.status === 404) {
    return { generation: null, state: emptyState() };
  }
  if (!metadataResponse.ok) {
    throw new Error(`Push subscription metadata failed (${metadataResponse.status})`);
  }
  const metadata = (await metadataResponse.json()) as { generation?: string };
  const contentResponse = await fetch(`${metadataUrl()}?alt=media`, { headers });
  if (!contentResponse.ok) {
    throw new Error(`Push subscription read failed (${contentResponse.status})`);
  }
  const candidate = (await contentResponse.json()) as Partial<PushState>;
  return {
    generation: metadata.generation ?? null,
    state:
      candidate.version === 1 &&
      candidate.subscriptions &&
      typeof candidate.subscriptions === "object" &&
      !Array.isArray(candidate.subscriptions)
        ? { version: 1, subscriptions: candidate.subscriptions }
        : emptyState(),
  };
}

async function writeState(
  state: PushState,
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
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(state),
    },
  );
  if (response.status === 412) return false;
  if (!response.ok) {
    throw new Error(`Push subscription write failed (${response.status})`);
  }
  return true;
}

async function updateState(
  mutate: (state: PushState) => PushState,
): Promise<PushState> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readState();
    const next = mutate(current.state);
    if (await writeState(next, current.generation)) return next;
  }
  throw new Error("Push subscriptions changed too often; retry the request.");
}

export async function listPushSubscriptions(): Promise<PushSubscription[]> {
  const state = (await readState()).state;
  return Object.values(state.subscriptions)
    .map((entry) => entry.subscription)
    .filter(validSubscription);
}

export async function savePushSubscription(
  subscription: unknown,
): Promise<boolean> {
  if (!validSubscription(subscription)) return false;
  await updateState((state) => ({
    ...state,
    subscriptions: {
      ...state.subscriptions,
      [subscription.endpoint]: {
        subscription,
        updatedAt: new Date().toISOString(),
      },
    },
  }));
  return true;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await updateState((state) => {
    const subscriptions = { ...state.subscriptions };
    delete subscriptions[endpoint];
    return { ...state, subscriptions };
  });
}
