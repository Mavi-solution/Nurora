"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Alert, Button, fieldClass } from "@/components/ui";

// Google only appears when it has actually been configured in Supabase.
// Showing it otherwise just hands people a button that always fails.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const oauthError = params.get("error");
  const justSignedUp = params.get("signedup") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = createClient();

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError(friendlyAuthError(error.message));
      setBusy(false);
      return;
    }

    // Full navigation so middleware and server components see the cookie.
    router.replace(next);
    router.refresh();
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }

    setBusy(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/settings`,
    });

    setBusy(false);
    if (error) setError(error.message);
    else setNotice(`If ${email.trim()} has an account, a reset link is on its way.`);
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {justSignedUp && (
        <Alert tone="success">
          Account created. Sign in with your email and password.
        </Alert>
      )}
      {(error || oauthError) && <Alert tone="error">{error ?? oauthError}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <form onSubmit={signIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-[13px] font-medium mb-1.5">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor="password" className="block text-[13px] font-medium">
              Password
            </label>
            <button
              type="button"
              onClick={resetPassword}
              className="text-[12px] text-muted hover:text-body transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${fieldClass} pr-16`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted hover:text-body transition-colors"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {GOOGLE_ENABLED && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[12px] text-faint uppercase tracking-wider">or</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>

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
        </>
      )}

      <p className="text-[13px] text-muted text-center">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-brand-700 dark:text-brand-300 font-medium hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}

/** Supabase's auth errors are terse; make the common ones readable. */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password don't match an account. Check them, or create an account.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email address first — check your inbox for the link we sent.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
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
