"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Client, type Conversation } from "@twilio/conversations";
import { Call, Device } from "@twilio/voice-sdk";

export type VoiceState =
  | { kind: "idle" }
  | { kind: "incoming"; call: Call; from: string }
  | { kind: "connecting"; call: Call; to: string }
  | { kind: "active"; call: Call; peer: string; startedAt: number };

interface TwilioContextValue {
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  identity: string;
  businessNumber: string;
  conversations: Conversation[];
  /** Bumps whenever any conversation gets a new message (for re-renders). */
  messagesVersion: number;
  voice: VoiceState;
  muted: boolean;
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
  const [identity, setIdentity] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messagesVersion, setMessagesVersion] = useState(0);
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });
  const [muted, setMuted] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const voiceRef = useRef<VoiceState>({ kind: "idle" });
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

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
        conversationsClient.on("initialized", refreshList);
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

        // --- Voice ---
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
        device.on("error", () => {
          // Device-level errors (e.g. network); drop back to idle.
          setVoice((v) => (v.kind === "idle" ? v : { kind: "idle" }));
        });
        await device.register();

        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            error instanceof Error ? error.message : "failed to initialize",
          );
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      conversationsClient?.shutdown();
      device?.destroy();
      deviceRef.current = null;
    };
  }, []);

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
        identity,
        businessNumber,
        conversations,
        messagesVersion,
        voice,
        muted,
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
