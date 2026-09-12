"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useDictation } from "@/components/dictation";
import { postTeamMessage, sendDirectMessage } from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui";
import type { Profile, StaffMate, TeamMessage } from "@/lib/types";

/**
 * The floating bar: team chat, a Quick Book shortcut and dictation.
 *
 * The recipient picker is what makes this more than a broadcast box — a
 * counsellor mid-clinic can fire a private line to the booking desk or
 * an admin without leaving the schedule.
 *
 * Dictation uses the browser's built-in SpeechRecognition — no external
 * service, and the button simply hides where it is unsupported.
 */
export function TeamComposer({
  profile,
  mates,
  onQuickBook,
}: {
  profile: Profile;
  mates: StaffMate[];
  onQuickBook: () => void;
}) {
  const [body, setBody] = useState("");
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [recent, setRecent] = useState<TeamMessage[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  // Keep the last few team messages live above the composer.
  useEffect(() => {
    let active = true;

    supabase
      .from("team_messages")
      .select("*, author:profiles(id, full_name, avatar_url, role)")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (active && data) setRecent(data as TeamMessage[]);
      });

    const channel = supabase
      .channel("team-composer")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_messages" },
        (payload) => {
          setRecent((prev) => [payload.new as TeamMessage, ...prev].slice(0, 5));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const dictation = useDictation({
    onText: setBody,
    baseline: () => body,
  });

  const recipient = mates.find((m) => m.id === recipientId) ?? null;

  function send() {
    const text = body.trim();
    if (!text) return;

    setError(null);
    setSent(null);
    startTransition(async () => {
      const result = recipient
        ? await sendDirectMessage(recipient.id, text)
        : await postTeamMessage(text);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setBody("");
      // A DM does not appear in the channel strip above, so confirm it
      // went somewhere rather than leaving the box to just empty itself.
      if (recipient) {
        setSent(`Sent to ${recipient.full_name || "your colleague"}`);
        setTimeout(() => setSent(null), 2600);
      }
    });
  }

  return (
    <div className="fixed bottom-0 inset-x-0 lg:pl-64 z-30 pointer-events-none">
      <div className="mx-auto max-w-2xl px-4 pb-4 pointer-events-auto">
        {showRecent && !recipient && recent.length > 0 && (
          <div className="mb-2 rounded-2xl border border-hairline bg-card shadow-card overflow-hidden animate-in-up">
            <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between">
              <span className="text-[12px] font-semibold">Team channel</span>
              <Link
                href="/team"
                className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
              >
                Open
              </Link>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {[...recent].reverse().map((m) => (
                <div key={m.id} className="px-4 py-2.5 border-b border-hairline last:border-0">
                  <p className="text-[12px] text-muted">
                    {m.author?.full_name ?? "Someone"} ·{" "}
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-[13px] mt-0.5 whitespace-pre-wrap break-words">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {(error || dictation.error) && (
          <p className="mb-2 text-[12px] text-red-600 bg-card border border-hairline rounded-xl px-3 py-2">
            {error ?? dictation.error}
          </p>
        )}

        {sent && (
          <p className="mb-2 text-[12px] text-emerald-700 dark:text-emerald-300 bg-card border border-hairline rounded-xl px-3 py-2">
            {sent}
          </p>
        )}

        {showPicker && (
          <div className="mb-2 rounded-2xl border border-hairline bg-card shadow-card overflow-hidden animate-in-up">
            <div className="px-4 py-2.5 border-b border-hairline">
              <span className="text-[12px] font-semibold">Send to</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setRecipientId(null);
                  setShowPicker(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-hairline last:border-0 transition-colors ${
                  recipientId === null ? "bg-brand-50 dark:bg-brand-400/10" : "hover:bg-card-muted"
                }`}
              >
                <span className="size-7 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200 grid place-items-center shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">Team channel</span>
                  <span className="block text-[12px] text-muted">Everyone on shift</span>
                </span>
              </button>

              {mates.map((mate) => (
                <button
                  key={mate.id}
                  type="button"
                  onClick={() => {
                    setRecipientId(mate.id);
                    setShowPicker(false);
                    textareaRef.current?.focus();
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-hairline last:border-0 transition-colors ${
                    recipientId === mate.id ? "bg-brand-50 dark:bg-brand-400/10" : "hover:bg-card-muted"
                  }`}
                >
                  <Avatar name={mate.full_name || "?"} url={mate.avatar_url} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium truncate">
                      {mate.full_name || "Unnamed"}
                    </span>
                    <span className="block text-[12px] text-muted truncate">
                      {describeRole(mate)}
                    </span>
                  </span>
                  {mate.unread > 0 && (
                    <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold grid place-items-center tabular-nums shrink-0">
                      {mate.unread > 9 ? "9+" : mate.unread}
                    </span>
                  )}
                </button>
              ))}

              {mates.length === 0 && (
                <p className="px-4 py-5 text-[12px] text-muted text-center">
                  No colleagues to message yet.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-[1.75rem] border border-hairline bg-card/95 backdrop-blur-xl shadow-card p-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setShowRecent(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape") {
                setShowRecent(false);
                setShowPicker(false);
              }
            }}
            rows={1}
            placeholder={
              dictation.listening
                ? "Listening…"
                : recipient
                  ? `Message ${recipient.full_name || "your colleague"}…`
                  : "Message the team…"
            }
            aria-label={
              recipient
                ? `Message ${recipient.full_name}`
                : "Message the team"
            }
            className="w-full resize-none bg-transparent px-3 py-2 text-sm focus:outline-none max-h-28"
          />

          <div className="flex items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => setShowRecent((v) => !v)}
              aria-label="Toggle team channel"
              aria-expanded={showRecent}
              className="size-8 grid place-items-center rounded-full border border-hairline text-muted hover:text-body hover:bg-card-muted transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              aria-label="Choose who to message"
              aria-expanded={showPicker}
              className={`inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full border text-[13px] font-medium transition-colors max-w-44 ${
                recipient
                  ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-100"
                  : "border-hairline text-muted hover:text-body hover:bg-card-muted"
              }`}
            >
              {recipient ? (
                <Avatar name={recipient.full_name || "?"} url={recipient.avatar_url} size={18} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
                </svg>
              )}
              <span className="truncate">
                {recipient ? recipient.full_name.split(" ")[0] || "Colleague" : "Team"}
              </span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onQuickBook}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-hairline text-[13px] font-medium text-muted hover:text-body hover:bg-card-muted transition-colors"
            >
              Quick book
            </button>

            <div className="flex-1" />

            {dictation.supported && (
              <button
                type="button"
                onClick={dictation.toggle}
                aria-label={dictation.listening ? "Stop dictation" : "Dictate a message"}
                aria-pressed={dictation.listening}
                className={`size-8 grid place-items-center rounded-full transition-colors ${
                  dictation.listening
                    ? "bg-red-500 text-white animate-pulse"
                    : "text-muted hover:text-body hover:bg-card-muted"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={send}
              disabled={pending || body.trim() === ""}
              aria-label="Send message"
              className="size-8 grid place-items-center rounded-full bg-brand-600 text-white transition-all hover:bg-brand-700 disabled:opacity-40 disabled:pointer-events-none"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-faint mt-1.5">
          {recipient
            ? `Private to ${recipient.full_name || "your colleague"} · Enter to send`
            : `Signed in as ${profile.full_name || "you"} · Enter to send`}
        </p>
      </div>
    </div>
  );
}

function describeRole(mate: StaffMate): string {
  if (mate.is_admin && mate.role === "counsellor") return "Counsellor · admin";
  if (mate.role === "support") return "Booking desk";
  if (mate.role === "admin") return "Admin";
  if (mate.role === "counsellor") return "Counsellor";
  return "Team";
}
