"use client";

import { useState } from "react";
import { formatPhone } from "@/lib/format";
import { useTwilio } from "./TwilioProvider";

const KEYS: Array<[string, string]> = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

export default function DialerModal({ onClose }: { onClose: () => void }) {
  const { dial, voice, businessNumber, contacts } = useTwilio();
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[300px] rounded-[24px] p-6 text-center shadow-2xl backdrop-blur-2xl"
        style={{ background: "var(--bg-sidebar)", border: "1px solid var(--hairline)" }}
      >
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="(555) 123-4567"
          autoFocus
          inputMode="tel"
          onKeyDown={(e) => {
            if (e.key === "Enter") placeCall();
          }}
          className="mb-1 w-full bg-transparent text-center text-[28px] font-light tracking-tight outline-none placeholder:text-[color:var(--text-secondary)]"
        />
        <p className="mb-5 text-[11px] text-[color:var(--text-secondary)]">
          Calling from {formatPhone(businessNumber)}
        </p>
        {contacts.length > 0 && (
          <select
            aria-label="Choose a saved contact"
            defaultValue=""
            onChange={(event) => setNumber(event.target.value)}
            className="mb-4 w-full rounded-[9px] border border-[color:var(--hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[color:var(--text-secondary)] outline-none"
          >
            <option value="" disabled>Saved contacts</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.phone}>{contact.name} · {formatPhone(contact.phone)}</option>)}
          </select>
        )}
        <div className="mb-5 grid grid-cols-3 gap-x-6 gap-y-3.5 px-2">
          {KEYS.map(([digit, letters]) => (
            <button
              key={digit}
              onClick={() => setNumber((n) => n + digit)}
              className="mx-auto flex h-[62px] w-[62px] flex-col items-center justify-center rounded-full bg-black/[0.06] transition-colors hover:bg-black/[0.12] active:bg-black/[0.2] dark:bg-white/[0.09] dark:hover:bg-white/[0.16]"
            >
              <span className="text-[26px] font-normal leading-none">{digit}</span>
              <span className="mt-0.5 h-[9px] text-[8px] font-semibold tracking-[0.15em] text-[color:var(--text-secondary)]">
                {letters}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-8">
          <span className="w-10" />
          <button
            onClick={placeCall}
            disabled={!number.trim() || voice.kind !== "idle"}
            aria-label="Call"
            className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[#30d158] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.6 3.2c.6-.6 1.6-.6 2.2.1l1.9 2.3c.5.6.5 1.5 0 2.1l-1 1.2c-.2.3-.3.7-.1 1 .8 1.6 2.9 3.7 4.5 4.5.3.2.7.1 1-.1l1.2-1c.6-.5 1.5-.5 2.1 0l2.3 1.9c.7.6.7 1.6.1 2.2l-1.2 1.3c-.6.6-1.5.9-2.3.7-3.2-.8-6.2-2.5-8.6-4.9S4.7 9.1 3.9 5.9c-.2-.8 0-1.7.7-2.3l2-.4Z" />
            </svg>
          </button>
          <button
            onClick={() => setNumber((n) => n.slice(0, -1))}
            aria-label="Delete digit"
            className="flex w-10 items-center justify-center text-[color:var(--text-secondary)] transition-colors hover:text-foreground"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8.5 5h10A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-10L2.6 13a1.5 1.5 0 0 1 0-2L8.5 5Z" />
              <path d="m11.5 9.5 5 5m0-5-5 5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
