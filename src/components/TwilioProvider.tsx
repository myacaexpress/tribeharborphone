"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { Client, type Conversation } from "@twilio/conversations";
import { Call, Device } from "@twilio/voice-sdk";
import {
  CONTACTS_ATTRIBUTE,
  parseContacts,
  type Contact,
} from "@/lib/contacts";
import type { WorkspaceAction, WorkspacePayload } from "@/lib/workspace";

export type VoiceState =
  | { kind: "idle" }
  | { kind: "incoming"; call: Call; from: string }
  | { kind: "connecting"; call: Call; to: string }
  | { kind: "active"; call: Call; peer: string; startedAt: number };

interface TwilioContextValue {
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  voiceStatus: "loading" | "ready" | "error";
  voiceErrorMessage: string | null;
  identity: string;
  businessNumber: string;
  conversations: Conversation[];
  contacts: Contact[];
  workspaceStatus: "loading" | "ready" | "error";
  workspaceError: string | null;
  openActions: WorkspaceAction[];
  /** Bumps whenever any conversation gets a new message (for re-renders). */
  messagesVersion: number;
  voice: VoiceState;
  muted: boolean;
  saveContact: (contact: Contact) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  updateActionStatus: (actionId: string, status: string) => Promise<void>;
  dial: (to: string) => Promise<void>;
  acceptIncoming: () => void;
  rejectIncoming: () => void;
  hangup: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
}

export const TwilioContext = createContext<TwilioContextValue | null>(null);
export type { TwilioContextValue };

export function useTwilio(): TwilioContextValue {
  const value = useContext(TwilioContext);
  if (!value) throw new Error("useTwilio must be used inside TwilioProvider");
  return value;
}

async function fetchToken(): Promise<{
  token: string;
  identity: string;
  businessNumber: string;
}> {
  const res = await fetch("/api/token");
  if (!res.ok) throw new Error(`token request failed (${res.status})`);
  return res.json();
}

function describeTwilioError(error: unknown): string {
  const value = error as {
    code?: number;
    message?: string;
    description?: string;
    error?: unknown;
  } | null;
  if (value?.error && value.error !== error) {
    return describeTwilioError(value.error);
  }
  if (value?.code === 20101 || value?.message?.includes("AccessTokenInvalid")) {
    return "Twilio rejected the app credential. Replace the API key, then refresh.";
  }
  if (value?.message?.includes("Twilsock has disconnected")) {
    return "Twilio messaging could not connect. Check the API key and network, then refresh.";
  }
  return value?.description ?? value?.message ?? "Twilio failed to initialize";
}

function sortByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const ta = (a.lastMessage?.dateCreated ?? a.dateCreated)?.getTime() ?? 0;
    const tb = (b.lastMessage?.dateCreated ?? b.dateCreated)?.getTime() ?? 0;
    return tb - ta;
  });
}

export function TwilioProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [voiceErrorMessage, setVoiceErrorMessage] = useState<string | null>(
    null,
  );
  const [identity, setIdentity] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [savedContacts, setSavedContacts] = useState<Contact[]>([]);
  const [workspaceContacts, setWorkspaceContacts] = useState<Contact[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [openActions, setOpenActions] = useState<WorkspaceAction[]>([]);
  const [messagesVersion, setMessagesVersion] = useState(0);
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });
  const [muted, setMuted] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const conversationsClientRef = useRef<Client | null>(null);
  const savedContactsRef = useRef<Contact[]>([]);
  const voiceRef = useRef<VoiceState>({ kind: "idle" });
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    savedContactsRef.current = savedContacts;
  }, [savedContacts]);

  const contacts = useMemo(() => {
    const byPhone = new Map<string, Contact>();
    for (const contact of workspaceContacts) byPhone.set(contact.phone, contact);
    for (const contact of savedContacts) byPhone.set(contact.phone, contact);
    return [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [savedContacts, workspaceContacts]);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceStatus("loading");
    setWorkspaceError(null);
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const body = await response.json() as WorkspacePayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Command Center sync failed.");
      setWorkspaceContacts(body.contacts);
      setOpenActions(body.actions);
      setWorkspaceStatus("ready");
    } catch (error) {
      setWorkspaceStatus("error");
      setWorkspaceError(
        error instanceof Error ? error.message : "Command Center sync failed.",
      );
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshWorkspace();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshWorkspace]);

  useEffect(() => {
    let cancelled = false;
    let conversationsClient: Client | null = null;
    let device: Device | null = null;

    async function init() {
      try {
        const { token, identity, businessNumber } = await fetchToken();
        if (cancelled) return;
        setIdentity(identity);
        setBusinessNumber(businessNumber);

        // --- Messaging ---
        conversationsClient = new Client(token);
        conversationsClientRef.current = conversationsClient;
        const refreshList = async () => {
          if (!conversationsClient) return;
          const page = await conversationsClient.getSubscribedConversations();
          const items = [...page.items];
          let cursor = page;
          while (cursor.hasNextPage) {
            cursor = await cursor.nextPage();
            items.push(...cursor.items);
          }
          if (!cancelled) setConversations(sortByRecent(items));
        };
        const messagingReady = new Promise<void>((resolve, reject) => {
          conversationsClient?.on("initialized", async () => {
            try {
              if (conversationsClient) {
                const initialContacts = parseContacts(conversationsClient.user.attributes);
                savedContactsRef.current = initialContacts;
                setSavedContacts(initialContacts);
                conversationsClient.user.on("updated", ({ user, updateReasons }) => {
                  if (!cancelled && updateReasons.includes("attributes")) {
                    const updatedContacts = parseContacts(user.attributes);
                    savedContactsRef.current = updatedContacts;
                    setSavedContacts(updatedContacts);
                  }
                });
              }
              await refreshList();
              resolve();
            } catch (error) {
              reject(error);
            }
          });
          conversationsClient?.on("initFailed", ({ error }) => reject(error));
        });
        conversationsClient.on("conversationJoined", refreshList);
        conversationsClient.on("conversationLeft", refreshList);
        conversationsClient.on("conversationUpdated", () => {
          if (!cancelled) {
            setConversations((prev) => sortByRecent(prev));
            setMessagesVersion((v) => v + 1);
          }
        });
        conversationsClient.on("messageAdded", () => {
          if (!cancelled) {
            setConversations((prev) => sortByRecent(prev));
            setMessagesVersion((v) => v + 1);
          }
        });
        conversationsClient.on("tokenAboutToExpire", async () => {
          const fresh = await fetchToken();
          await conversationsClient?.updateToken(fresh.token);
          deviceRef.current?.updateToken(fresh.token);
        });

        await messagingReady;
        if (cancelled) return;
        setStatus("ready");

        // --- Voice ---
        // Voice registration is independent of Conversations. If it fails,
        // messaging remains usable and the call control explains why it is
        // unavailable instead of replacing the entire app with an error page.
        try {
          device = new Device(token, {
            codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          });
          deviceRef.current = device;
          device.on("incoming", (call: Call) => {
            // One call at a time: auto-reject if busy.
            if (voiceRef.current.kind !== "idle") {
              call.reject();
              return;
            }
            const from = call.parameters.From ?? "Unknown";
            call.on("disconnect", () => setVoice({ kind: "idle" }));
            call.on("cancel", () => setVoice({ kind: "idle" }));
            call.on("reject", () => setVoice({ kind: "idle" }));
            setVoice({ kind: "incoming", call, from });
          });
          device.on("error", (error) => {
            setVoice((v) => (v.kind === "idle" ? v : { kind: "idle" }));
            setVoiceStatus("error");
            setVoiceErrorMessage(describeTwilioError(error));
          });
          await device.register();
          if (!cancelled) {
            setVoiceStatus("ready");
            setVoiceErrorMessage(null);
          }
        } catch (error) {
          device?.destroy();
          device = null;
          deviceRef.current = null;
          if (!cancelled) {
            setVoiceStatus("error");
            setVoiceErrorMessage(describeTwilioError(error));
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(describeTwilioError(error));
          setVoiceStatus("error");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      conversationsClient?.shutdown();
      conversationsClientRef.current = null;
      device?.destroy();
      deviceRef.current = null;
    };
  }, []);

  const persistContacts = useCallback(async (nextContacts: Contact[]) => {
    const client = conversationsClientRef.current;
    if (!client) throw new Error("Contacts are still connecting. Try again in a moment.");
    const currentAttributes = client.user.attributes;
    const attributes =
      currentAttributes && typeof currentAttributes === "object" && !Array.isArray(currentAttributes)
        ? currentAttributes
        : {};
    const sorted = [...nextContacts].sort((a, b) => a.name.localeCompare(b.name));
    const serialized = sorted.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      group: contact.group,
    }));
    await client.user.updateAttributes({
      ...attributes,
      [CONTACTS_ATTRIBUTE]: serialized,
    });
    savedContactsRef.current = sorted;
    setSavedContacts(sorted);
  }, []);

  const saveContact = useCallback(async (contact: Contact) => {
    const savedContact = { ...contact, source: "saved" as const };
    const next = savedContactsRef.current.filter(
      (item) => item.id !== savedContact.id && item.phone !== savedContact.phone,
    );
    next.push(savedContact);
    await persistContacts(next);
  }, [persistContacts]);

  const deleteContact = useCallback(async (id: string) => {
    await persistContacts(
      savedContactsRef.current.filter((contact) => contact.id !== id),
    );
  }, [persistContacts]);

  const updateActionStatus = useCallback(async (
    actionId: string,
    nextStatus: string,
  ) => {
    const response = await fetch(
      `/api/workspace/actions/${encodeURIComponent(actionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      },
    );
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? "Could not update the action.");
    }
    await refreshWorkspace();
  }, [refreshWorkspace]);

  const dial = useCallback(async (to: string) => {
    const device = deviceRef.current;
    if (!device || voiceRef.current.kind !== "idle") return;
    const call = await device.connect({ params: { To: to } });
    setMuted(false);
    setVoice({ kind: "connecting", call, to });
    call.on("accept", () =>
      setVoice({ kind: "active", call, peer: to, startedAt: Date.now() }),
    );
    call.on("disconnect", () => setVoice({ kind: "idle" }));
    call.on("cancel", () => setVoice({ kind: "idle" }));
    call.on("error", () => setVoice({ kind: "idle" }));
  }, []);

  const acceptIncoming = useCallback(() => {
    const state = voiceRef.current;
    if (state.kind !== "incoming") return;
    setMuted(false);
    state.call.accept();
    setVoice({
      kind: "active",
      call: state.call,
      peer: state.from,
      startedAt: Date.now(),
    });
  }, []);

  const rejectIncoming = useCallback(() => {
    const state = voiceRef.current;
    if (state.kind !== "incoming") return;
    state.call.reject();
    setVoice({ kind: "idle" });
  }, []);

  const hangup = useCallback(() => {
    const state = voiceRef.current;
    if (state.kind === "idle") return;
    state.call.disconnect();
    setVoice({ kind: "idle" });
  }, []);

  const toggleMute = useCallback(() => {
    const state = voiceRef.current;
    if (state.kind !== "active") return;
    const next = !state.call.isMuted();
    state.call.mute(next);
    setMuted(next);
  }, []);

  const sendDigits = useCallback((digits: string) => {
    const state = voiceRef.current;
    if (state.kind !== "active") return;
    state.call.sendDigits(digits);
  }, []);

  return (
    <TwilioContext.Provider
      value={{
        status,
        errorMessage,
        voiceStatus,
        voiceErrorMessage,
        identity,
        businessNumber,
        conversations,
        contacts,
        workspaceStatus,
        workspaceError,
        openActions,
        messagesVersion,
        voice,
        muted,
        saveContact,
        deleteContact,
        refreshWorkspace,
        updateActionStatus,
        dial,
        acceptIncoming,
        rejectIncoming,
        hangup,
        toggleMute,
        sendDigits,
      }}
    >
      {children}
    </TwilioContext.Provider>
  );
}
