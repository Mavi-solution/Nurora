"use client";

import { useEffect, useState } from "react";

/**
 * Ticks once a second from a fixed start instant.
 *
 * Elapsed time is deliberately NOT computed during render: the server and
 * the client would each measure "now" at a different moment and React
 * would report a hydration mismatch. The first paint is always 00:00:00
 * on both sides, and the real value arrives on mount.
 */
export function SessionTimer({
  startedAt,
  className = "",
}: {
  startedAt: string;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    setElapsed(secondsSince(startedAt));
    const id = setInterval(() => setElapsed(secondsSince(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span
      className={`tabular-nums font-medium ${className}`}
      role="timer"
      aria-live="off"
      suppressHydrationWarning
    >
      {formatElapsed(elapsed ?? 0)}
    </span>
  );
}

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
