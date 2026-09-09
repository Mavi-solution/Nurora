"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types";

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as Notification[]);
    setLoading(false);
  }, [supabase]);

  // Live-update the badge when the reminder job inserts a notification.
  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev].slice(0, 20));
          setUnread((n) => n + 1);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Click-away and Escape both close the panel.
  useEffect(() => {
    if (!open) return;

    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    await load();
    if (unread > 0) {
      setUnread(0);
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative size-9 grid place-items-center rounded-full text-muted hover:text-body hover:bg-card-muted transition-colors"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
          <path d="M10.5 18a1.8 1.8 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold grid place-items-center tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-card shadow-card overflow-hidden animate-in-up">
          <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
            <span className="text-[13px] font-semibold">Notifications</span>
            <Link
              href="/notifications"
              className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
            >
              View all
            </Link>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <p className="px-4 py-6 text-[13px] text-muted text-center">Loading…</p>
            )}

            {!loading && items.length === 0 && (
              <p className="px-4 py-8 text-[13px] text-muted text-center">
                Nothing yet. Session reminders land here three days ahead.
              </p>
            )}

            {items.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: Notification }) {
  const body = (
    <div
      className={`px-4 py-3 border-b border-hairline last:border-0 hover:bg-card-muted transition-colors ${
        n.read_at ? "" : "bg-brand-50/50 dark:bg-brand-400/5"
      }`}
    >
      <p className="text-[13px] font-medium">{n.title}</p>
      <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{n.body}</p>
      <p className="text-[11px] text-faint mt-1">
        {new Date(n.created_at).toLocaleString()}
      </p>
    </div>
  );

  return n.appointment_id ? (
    <Link href={`/appointments/${n.appointment_id}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
