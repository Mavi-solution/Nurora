"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar, Card, EmptyState } from "@/components/ui";
import {
  deleteDirectMessage,
  deleteTeamMessage,
  markThreadRead,
  postTeamMessage,
  sendDirectMessage,
} from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/client";
import type { DirectMessage, Profile, StaffMate, TeamMessage } from "@/lib/types";

/**
 * The Team screen: one shared channel plus a private thread per
 * colleague. Both live over the same Supabase realtime socket.
 */
export function TeamWorkspace({
  profile,
  mates,
  activeId,
  channelMessages,
  threadMessages,
}: {
  profile: Profile;
  mates: StaffMate[];
  activeId: string | null;
  channelMessages: TeamMessage[];
  threadMessages: DirectMessage[];
}) {
  const router = useRouter();
  const [channel, setChannel] = useState(channelMessages);
  const [thread, setThread] = useState(threadMessages);
  const [unread, setUnread] = useState(() =>
    Object.fromEntries(mates.map((m) => [m.id, m.unread])),
  );
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showList, setShowList] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const active = mates.find((m) => m.id === activeId) ?? null;

  // Server-rendered props change on every navigation between threads.
  useEffect(() => setChannel(channelMessages), [channelMessages]);
  useEffect(() => setThread(threadMessages), [threadMessages]);
  useEffect(() => {
    setUnread(Object.fromEntries(mates.map((m) => [m.id, m.unread])));
  }, [mates]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channel.length, thread.length, activeId]);

  // Opening a thread clears its badge.
  useEffect(() => {
    if (!activeId) return;
    setUnread((prev) => ({ ...prev, [activeId]: 0 }));
    void markThreadRead(activeId);
  }, [activeId]);

  /* ------------------------------------------------ realtime: channel */
  useEffect(() => {
    const sub = supabase
      .channel("team-page")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_messages" },
        async (payload) => {
          const incoming = payload.new as TeamMessage;
          // The realtime payload has no joined author, so fetch it.
          const { data: author } = await supabase
            .from("profiles")
            .select("id, full_name, avatar_url, role")
            .eq("id", incoming.author_id)
            .maybeSingle();

          setChannel((prev) =>
            prev.some((m) => m.id === incoming.id)
              ? prev
              : [...prev, { ...incoming, author: author ?? null }],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "team_messages" },
        (payload) => {
          const gone = payload.old as TeamMessage;
          setChannel((prev) => prev.filter((m) => m.id !== gone.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(sub);
    };
  }, [supabase]);

  /* ------------------------------------------------- realtime: threads */
  useEffect(() => {
    const sub = supabase
      .channel("direct-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages" },
        (payload) => {
          const dm = payload.new as DirectMessage;

          // RLS filters the stream, but a broadcast can still carry rows
          // for a different thread of mine — route it, don't assume.
          const mine = dm.sender_id === profile.id || dm.recipient_id === profile.id;
          if (!mine) return;

          const other = dm.sender_id === profile.id ? dm.recipient_id : dm.sender_id;

          if (other === activeId) {
            setThread((prev) =>
              prev.some((m) => m.id === dm.id) ? prev : [...prev, dm],
            );
            if (dm.recipient_id === profile.id) void markThreadRead(other);
          } else if (dm.recipient_id === profile.id) {
            setUnread((prev) => ({ ...prev, [other]: (prev[other] ?? 0) + 1 }));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "direct_messages" },
        (payload) => {
          const gone = payload.old as DirectMessage;
          setThread((prev) => prev.filter((m) => m.id !== gone.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(sub);
    };
  }, [supabase, profile.id, activeId]);

  /* --------------------------------------------------------- sending */
  const send = useCallback(() => {
    const text = body.trim();
    if (!text) return;

    setError(null);
    startTransition(async () => {
      const result = active
        ? await sendDirectMessage(active.id, text)
        : await postTeamMessage(text);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setBody("");
      // The optimistic echo: realtime also delivers our own insert, and
      // both paths de-duplicate on id.
      if (active && "data" in result && result.data) {
        const dm = result.data as DirectMessage;
        setThread((prev) => (prev.some((m) => m.id === dm.id) ? prev : [...prev, dm]));
      }
      router.refresh();
    });
  }, [active, body, router]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-[13px] text-muted mt-0.5">
            A shared channel for the practice, plus a private thread with
            anyone on the team. Clients never see any of this.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          className="lg:hidden shrink-0 relative inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-hairline text-[13px] font-medium hover:bg-card-muted transition-colors"
        >
          Chats
          {totalUnread > 0 && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold grid place-items-center tabular-nums">
              {totalUnread > 9 ? "9+" : totalUnread}
            </span>
          )}
        </button>
      </div>

      <div className="grid lg:grid-cols-[16rem_1fr] gap-4">
        {/* ------------------------------------------------ conversations */}
        <Card
          className={`overflow-hidden self-start ${showList ? "" : "hidden lg:block"}`}
        >
          <div className="px-4 py-3 border-b border-hairline">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-faint">
              Conversations
            </span>
          </div>

          <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto">
            <ConversationLink
              href="/team"
              active={!activeId}
              title="Team channel"
              subtitle="Everyone on shift"
              onNavigate={() => setShowList(false)}
              icon={
                <span className="size-8 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200 grid place-items-center shrink-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
                  </svg>
                </span>
              }
            />

            {mates.length === 0 && (
              <p className="px-4 py-6 text-[13px] text-muted text-center">
                No colleagues yet.
              </p>
            )}

            {mates.map((mate) => (
              <ConversationLink
                key={mate.id}
                href={`/team?with=${mate.id}`}
                active={activeId === mate.id}
                title={mate.full_name || "Unnamed"}
                subtitle={mate.lastMessage ?? roleLabel(mate)}
                badge={unread[mate.id] ?? 0}
                onNavigate={() => setShowList(false)}
                icon={
                  <Avatar name={mate.full_name || "?"} url={mate.avatar_url} size={32} />
                }
              />
            ))}
          </div>
        </Card>

        {/* ------------------------------------------------------ thread */}
        <Card className="flex flex-col h-[calc(100dvh-16rem)] min-h-96">
          <div className="px-5 py-3.5 border-b border-hairline flex items-center gap-3">
            {active ? (
              <>
                <Avatar name={active.full_name || "?"} url={active.avatar_url} size={32} />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold truncate">
                    {active.full_name || "Unnamed"}
                  </p>
                  <p className="text-[12px] text-muted">{roleLabel(active)} · private</p>
                </div>
              </>
            ) : (
              <div>
                <p className="text-[14px] font-semibold">Team channel</p>
                <p className="text-[12px] text-muted">
                  Everyone with a staff login can read this
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {active ? (
              thread.length === 0 ? (
                <EmptyState
                  title={`No messages with ${active.full_name || "them"} yet`}
                  description="Anything you send here is visible only to the two of you."
                />
              ) : (
                thread.map((m) => (
                  <Bubble
                    key={m.id}
                    mine={m.sender_id === profile.id}
                    name={m.sender_id === profile.id ? "You" : active.full_name}
                    avatarName={
                      m.sender_id === profile.id ? profile.full_name : active.full_name
                    }
                    avatarUrl={
                      m.sender_id === profile.id ? profile.avatar_url : active.avatar_url
                    }
                    body={m.body}
                    createdAt={m.created_at}
                    onDelete={
                      m.sender_id === profile.id
                        ? () =>
                            startTransition(async () => {
                              await deleteDirectMessage(m.id);
                              setThread((prev) => prev.filter((x) => x.id !== m.id));
                            })
                        : undefined
                    }
                  />
                ))
              )
            ) : channel.length === 0 ? (
              <EmptyState title="No messages yet" description="Say hello to the team." />
            ) : (
              channel.map((m) => (
                <Bubble
                  key={m.id}
                  mine={m.author_id === profile.id}
                  name={
                    m.author_id === profile.id
                      ? "You"
                      : (m.author?.full_name ?? "Someone")
                  }
                  avatarName={m.author?.full_name ?? "?"}
                  avatarUrl={m.author?.avatar_url}
                  body={m.body}
                  createdAt={m.created_at}
                  onDelete={
                    m.author_id === profile.id
                      ? () =>
                          startTransition(async () => {
                            await deleteTeamMessage(m.id);
                            setChannel((prev) => prev.filter((x) => x.id !== m.id));
                          })
                      : undefined
                  }
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-hairline p-3">
            {error && <p className="text-[12px] text-red-600 mb-2 px-1">{error}</p>}
            <div className="flex gap-2 items-end">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={
                  active
                    ? `Message ${active.full_name || "your colleague"}…`
                    : "Message the team…"
                }
                aria-label={active ? `Message ${active.full_name}` : "Message the team"}
                className="flex-1 resize-none rounded-xl border border-[var(--border-strong)] bg-card px-3.5 py-2.5 text-sm transition-shadow placeholder:text-faint focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 focus:outline-none max-h-28"
              />
              <button
                type="button"
                onClick={send}
                disabled={pending || body.trim() === ""}
                className="size-10 shrink-0 grid place-items-center rounded-full bg-brand-600 text-white transition-all hover:bg-brand-700 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- bits */

function roleLabel(mate: StaffMate): string {
  if (mate.is_admin && mate.role === "counsellor") return "Counsellor · admin";
  if (mate.role === "support") return "Booking desk";
  if (mate.role === "admin") return "Admin";
  if (mate.role === "counsellor") return "Counsellor";
  return "Team";
}

function ConversationLink({
  href,
  active,
  title,
  subtitle,
  badge = 0,
  icon,
  onNavigate,
}: {
  href: string;
  active: boolean;
  title: string;
  subtitle: string;
  badge?: number;
  icon: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-4 py-3 border-b border-hairline last:border-0 transition-colors ${
        active ? "bg-brand-50 dark:bg-brand-400/10" : "hover:bg-card-muted"
      }`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate">{title}</p>
        <p className="text-[12px] text-muted truncate">{subtitle}</p>
      </div>
      {badge > 0 && (
        <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold grid place-items-center tabular-nums shrink-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function Bubble({
  mine,
  name,
  avatarName,
  avatarUrl,
  body,
  createdAt,
  onDelete,
}: {
  mine: boolean;
  name: string;
  avatarName: string;
  avatarUrl?: string | null;
  body: string;
  createdAt: string;
  onDelete?: () => void;
}) {
  return (
    <div className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
      <Avatar name={avatarName || "?"} url={avatarUrl} size={30} />
      <div className={`max-w-[75%] ${mine ? "text-right" : ""}`}>
        <p className="text-[12px] text-muted mb-1">
          {name} ·{" "}
          {new Date(createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <div
          className={`inline-block rounded-2xl px-3.5 py-2 text-[14px] text-left whitespace-pre-wrap break-words ${
            mine ? "bg-brand-600 text-white" : "bg-card-muted border border-hairline"
          }`}
        >
          {body}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="block ml-auto text-[11px] text-faint hover:text-red-600 mt-1 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
