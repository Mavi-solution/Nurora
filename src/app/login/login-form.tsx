"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Alert, Button, fieldClass } from "@/components/ui";

type Mode = "email" | "phone";
type Stage = "identify" | "verify";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const oauthError = params.get("error");

  const [mode, setMode] = useState<Mode>("email");
  const [stage, setStage] = useState<Stage>("identify");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = createClient();

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const { error } =
      mode === "email"
        ? await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: true },
          })
        : await supabase.auth.signInWithOtp({
            phone: normalisePhone(phone),
            options: { shouldCreateUser: true },
          });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }

    setStage("verify");
    setNotice(
      mode === "email"
        ? `We sent a 6-digit code to ${email.trim()}.`
        : `We sent a 6-digit code to ${normalisePhone(phone)}.`,
    );
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } =
      mode === "email"
        ? await supabase.auth.verifyOtp({
            email: email.trim(),
            token: code.trim(),
            type: "email",
          })
        : await supabase.auth.verifyOtp({
            phone: normalisePhone(phone),
            token: code.trim(),
            type: "sms",
          });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    // Full reload so middleware and server components see the new cookie.
    router.replace(next);
    router.refresh();
  }

  if (stage === "verify") {
    return (
      <form onSubmit={verifyCode} className="space-y-4">
        {notice && <Alert tone="info">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <div>
          <label htmlFor="code" className="block text-[13px] font-medium mb-1.5">
            Verification code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${fieldClass} text-center text-2xl tracking-[0.5em] font-medium tabular-nums`}
            placeholder="000000"
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy || code.length < 6}>
          {busy ? "Verifying…" : "Verify and continue"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setStage("identify");
            setCode("");
            setError(null);
            setNotice(null);
          }}
          className="w-full text-[13px] text-muted hover:text-body transition-colors"
        >
          Use a different {mode === "email" ? "email" : "number"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      {(error || oauthError) && <Alert tone="error">{error ?? oauthError}</Alert>}

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={busy}
      >
        <GoogleMark />
        Continue with Google
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[12px] text-faint uppercase tracking-wider">or</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="inline-flex w-full rounded-full bg-card-muted border border-hairline p-1">
        {(["email", "phone"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 h-8 rounded-full text-[13px] font-medium transition-colors ${
              mode === m
                ? "bg-card text-body shadow-sm"
                : "text-muted hover:text-body"
            }`}
          >
            {m === "email" ? "Email code" : "Phone code"}
          </button>
        ))}
      </div>

      <form onSubmit={sendCode} className="space-y-4">
        {mode === "email" ? (
          <div>
            <label htmlFor="email" className="block text-[13px] font-medium mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
              placeholder="you@example.com"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="phone" className="block text-[13px] font-medium mb-1.5">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
              placeholder="+91 98765 43210"
            />
            <span className="block text-[12px] text-faint mt-1.5">
              Include your country code.
            </span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Sending…" : "Send me a code"}
        </Button>
      </form>
    </div>
  );
}

function normalisePhone(input: string): string {
  const trimmed = input.replace(/[\s()-]/g, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.3Z" />
      <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1Z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.4 0-11.7-3.7-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48Z" />
    </svg>
  );
}
