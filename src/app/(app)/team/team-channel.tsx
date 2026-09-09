"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar, Button, Card, EmptyState, fieldClass } from "@/components/ui";
import { deleteTeamMessage, postTeamMessage } from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/client";
import type { Profile, TeamMessage } from "@/lib/types";

export function TeamChannel({
  profile,
  initialMessages,
}: {
  profile: Profile;
  initialMessages: TeamMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const channel = supabase
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

          setMessages((prev) =>
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
          setMessages((prev) => prev.filter((m) => m.id !== (payload.old as TeamMessage).id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

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
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-[13px] text-muted mt-0.5">
          A shared channel for the practice. Clients never see this.
        </p>
      </div>

      <Card className="flex flex-col h-[calc(100dvh-16rem)]">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" description="Say hello to the team." />
          ) : (
            messages.map((message) => {
              const mine = message.author_id === profile.id;
              return (
                <div key={message.id} className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar
                    name={message.author?.full_name ?? "?"}
                    url={message.author?.avatar_url}
                    size={30}
                  />
                  <div className={`max-w-[75%] ${mine ? "text-right" : ""}`}>
                    <p className="text-[12px] text-muted mb-1">
                      {mine ? "You" : (message.author?.full_name ?? "Someone")} ·{" "}
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <div
                      className={`inline-block rounded-2xl px-3.5 py-2 text-[14px] text-left whitespace-pre-wrap break-words ${
                        mine
                          ? "bg-brand-600 text-white"
                          : "bg-card-muted border border-hairline"
                      }`}
                    >
                      {message.body}
                    </div>
                    {mine && (
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(async () => {
                            await deleteTeamMessage(message.id);
                            setMessages((prev) => prev.filter((m) => m.id !== message.id));
                          })
                        }
                        className="block ml-auto text-[11px] text-faint hover:text-red-600 mt-1 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-hairline p-3">
          {error && <p className="text-[12px] text-red-600 mb-2 px-1">{error}</p>}
          <div className="flex gap-2">
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
              placeholder="Message the team…"
              aria-label="Message the team"
              className={`${fieldClass} resize-none max-h-28`}
            />
            <Button onClick={send} disabled={pending || body.trim() === ""}>
              Send
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
