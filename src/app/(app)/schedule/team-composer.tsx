"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { postTeamMessage } from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/client";
import type { Profile, TeamMessage } from "@/lib/types";

/**
 * The floating bar: team chat, a Quick Book shortcut and dictation.
 * Dictation uses the browser's built-in SpeechRecognition — no external
 * service, and the button simply hides where it is unsupported.
 */
export function TeamComposer({
  profile,
  onQuickBook,
}: {
  profile: Profile;
  onQuickBook: () => void;
}) {
  const [body, setBody] = useState("");
  const [recent, setRecent] = useState<TeamMessage[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  useEffect(() => {
    const Ctor =
      typeof window !== "undefined"
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition
        : undefined;
    setSpeechSupported(Boolean(Ctor));
  }, []);

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

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    const baseline = body;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setBody(`${baseline}${baseline ? " " : ""}${transcript}`.trimStart());
    };
    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was denied."
          : "Dictation failed. Try typing instead.",
      );
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      textareaRef.current?.focus();
    };

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }

  function send() {
    const text = body.trim();
    if (!text) return;

    setError(null);
    startTransition(async () => {
      const result = await postTeamMessage(text);
      if (!result.ok) setError(result.error);
      else setBody("");
    });
  }

  return (
    <div className="fixed bottom-0 inset-x-0 lg:pl-64 z-30 pointer-events-none">
      <div className="mx-auto max-w-2xl px-4 pb-4 pointer-events-auto">
        {showRecent && recent.length > 0 && (
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

        {error && (
          <p className="mb-2 text-[12px] text-red-600 bg-card border border-hairline rounded-xl px-3 py-2">
            {error}
          </p>
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
              if (e.key === "Escape") setShowRecent(false);
            }}
            rows={1}
            placeholder={listening ? "Listening…" : "Message the team…"}
            aria-label="Message the team"
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
              onClick={onQuickBook}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-hairline text-[13px] font-medium text-muted hover:text-body hover:bg-card-muted transition-colors"
            >
              Quick book
            </button>

            <div className="flex-1" />

            {speechSupported && (
              <button
                type="button"
                onClick={toggleDictation}
                aria-label={listening ? "Stop dictation" : "Dictate a message"}
                aria-pressed={listening}
                className={`size-8 grid place-items-center rounded-full transition-colors ${
                  listening
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
          Signed in as {profile.full_name || "you"} · Enter to send
        </p>
      </div>
    </div>
  );
}

/* --- Minimal typings for the Web Speech API (not in lib.dom yet). ------- */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
