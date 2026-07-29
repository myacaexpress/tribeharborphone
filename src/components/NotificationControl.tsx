"use client";

import { useEffect, useState } from "react";

type NotificationState =
  | "loading"
  | "unsupported"
  | "disabled"
  | "ready"
  | "subscribed"
  | "denied"
  | "error";

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function NotificationControl() {
  const [state, setState] = useState<NotificationState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported");
        return;
      }
      try {
        const configResponse = await fetch("/api/push/config");
        const config = (await configResponse.json()) as {
          enabled?: boolean;
          publicKey?: string | null;
        };
        if (!config.enabled || !config.publicKey) {
          setState("disabled");
          return;
        }
        setPublicKey(config.publicKey);
        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setState(subscription ? "subscribed" : "ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

  async function enable() {
    if (!publicKey) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error("subscription failed");
      setState("subscribed");
    } catch {
      setState("error");
    }
  }

  if (state === "loading" || state === "unsupported" || state === "disabled") {
    return null;
  }

  if (state === "subscribed") {
    return (
      <div className="min-h-11 px-4 py-2.5 text-[12px] text-[color:var(--text-secondary)]">
        Notifications on
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void enable()}
      disabled={state === "denied"}
      className="min-h-11 px-4 py-2.5 text-left text-[12px] font-medium text-[#0a7aff] disabled:text-[color:var(--text-secondary)]"
    >
      {state === "denied"
        ? "Notifications blocked in device settings"
        : state === "error"
          ? "Retry notifications"
          : "Enable notifications"}
    </button>
  );
}
