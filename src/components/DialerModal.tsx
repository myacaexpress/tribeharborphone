"use client";

import { useState } from "react";
import { formatPhone } from "@/lib/format";
import { useTwilio } from "./TwilioProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export default function DialerModal({ onClose }: { onClose: () => void }) {
  const { dial, voice, businessNumber } = useTwilio();
  const [number, setNumber] = useState("");

  async function placeCall() {
    const cleaned = number.replace(/[\s()-]/g, "");
    if (!cleaned) return;
    const to = cleaned.startsWith("+")
      ? cleaned
      : cleaned.length === 10
        ? `+1${cleaned}`
        : `+${cleaned}`;
    await dial(to);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900"
      >
        <p className="mb-1 text-xs text-neutral-400">
          Calling from {formatPhone(businessNumber)}
        </p>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="(555) 123-4567"
          autoFocus
          inputMode="tel"
          onKeyDown={(e) => {
            if (e.key === "Enter") placeCall();
          }}
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-center text-xl outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <div className="mb-4 grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setNumber((n) => n + k)}
              className="rounded-full bg-neutral-100 py-3 text-lg font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => setNumber((n) => n.slice(0, -1))}
            aria-label="Delete digit"
            className="rounded-full px-4 py-3 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ⌫
          </button>
          <button
            onClick={placeCall}
            disabled={!number.trim() || voice.kind !== "idle"}
            className="flex-1 rounded-full bg-green-600 py-3 font-semibold text-white hover:bg-green-500 disabled:opacity-50"
          >
            Call
          </button>
        </div>
      </div>
    </div>
  );
}
