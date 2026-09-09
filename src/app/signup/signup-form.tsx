"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { signUpWithPassword } from "@/lib/actions/auth";

type Role = "counsellor" | "client";

const MIN_PASSWORD = 8;

export function SignupForm({ isFirstAccount }: { isFirstAccount: boolean }) {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // The first account always runs the practice, so it must be a counsellor.
  const [role, setRole] = useState<Role>("counsellor");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) return setError("Enter your full name.");
    if (password.length < MIN_PASSWORD) {
      return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    }
    if (password !== confirm) return setError("The two passwords don't match.");

    setBusy(true);

    const result = await signUpWithPassword({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      role: isFirstAccount ? "counsellor" : role,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (result.needsConfirmation) {
      setConfirmEmail(true);
      setBusy(false);
      return;
    }

    router.replace(result.redirectTo);
    router.refresh();
  }

  if (confirmEmail) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          Almost there — we sent a confirmation link to{" "}
          <strong>{email.trim()}</strong>. Open it, then sign in.
        </Alert>
        <p className="text-[13px] text-muted leading-relaxed">
          Nothing arrived? Check spam. To skip this step entirely, turn off
          <strong> Confirm email</strong> under Authentication → Sign In /
          Providers in Supabase.
        </p>
        <Button
          size="lg"
          className="w-full"
          onClick={() => router.push("/login?signedup=1")}
        >
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {isFirstAccount && (
        <Alert tone="info">
          This first account is created as a{" "}
          <strong>counsellor with admin rights</strong> — your own lane on the
          schedule, plus the ability to manage everyone else.
        </Alert>
      )}

      <Field label="Full name" required>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={fieldClass}
          placeholder="Anisha"
          autoComplete="name"
          autoFocus
          required
        />
      </Field>

      <Field label="Email address" required>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldClass}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </Field>

      {/* Explicit label + htmlFor here: an implicit <label> wrapper would pull
          the Show/Hide button into the field's accessible name. */}
      <div>
        <label
          htmlFor="password"
          className="block text-[13px] font-medium mb-1.5 is-required"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${fieldClass} pr-16`}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted hover:text-body transition-colors"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <span className="block text-[12px] text-faint mt-1.5">
          At least {MIN_PASSWORD} characters.
        </span>
      </div>

      <div>
        <label
          htmlFor="confirm"
          className="block text-[13px] font-medium mb-1.5 is-required"
        >
          Confirm password
        </label>
        <input
          id="confirm"
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={fieldClass}
          placeholder="••••••••"
          autoComplete="new-password"
          required
        />
      </div>

      {!isFirstAccount && (
        <div>
          <span className="block text-[13px] font-medium mb-1.5">
            How will you use Nurora?
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "counsellor", label: "Counsellor", hint: "Run sessions" },
                { value: "client", label: "Client", hint: "Book sessions" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRole(option.value)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  role === option.value
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-400/10 ring-4 ring-brand-500/10"
                    : "border-hairline hover:bg-card-muted"
                }`}
              >
                <span className="block text-[13px] font-medium">{option.label}</span>
                <span className="block text-[12px] text-muted mt-0.5">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
