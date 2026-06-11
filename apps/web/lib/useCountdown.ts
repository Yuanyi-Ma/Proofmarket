"use client";
import { useEffect, useState } from "react";

function remainingSeconds(endsAt: string | null | undefined): number {
  if (!endsAt) return 0;
  const ms = Date.parse(endsAt) - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Seconds remaining until `endsAt` (ISO timestamp), ticking once per second;
 * 0 when absent or already passed. Used for the challenge-window W_c gate.
 */
export function useCountdown(endsAt: string | null | undefined): number {
  const [remaining, setRemaining] = useState(() => remainingSeconds(endsAt));

  useEffect(() => {
    setRemaining(remainingSeconds(endsAt));
    if (!endsAt) return;
    const timer = setInterval(() => {
      const next = remainingSeconds(endsAt);
      setRemaining(next);
      if (next <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return remaining;
}

/** 125 → "2:05" */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
