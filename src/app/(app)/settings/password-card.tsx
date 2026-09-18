"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import { changePassword } from "@/lib/actions/profile";

/**
 * Counsellors are set up with a temporary password; this replaces it.
 *
 * The current password is now asked for. It is what makes the most
 * common failure legible — retyping the temporary password you were
 * just handed is rejected by Supabase as "same password", which
 * previously surfaced as nothing at all.
 */
export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setDone(false);

    if (!current) return setError("Enter your current password.");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    if (password === current) {
      return setError("That is already your password. Choose a different one.");
    }

    startTransition(async () => {
      const result = await changePassword(password, current);
      if (!result.ok) return setError(result.error);
      setCurrent("");
      setPassword("");
      setConfirm("");
      setDone(true);
    });
  }

  const type = reveal ? "text" : "password";

  return (
    <Card>
      <CardHeader
        title="Password"
        description="If the practice set you up, replace the temporary password here."
      />
      <div className="px-5 py-4 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {done && (
          <Alert tone="success">
            Password changed. Use the new one next time you sign in.
          </Alert>
        )}

        <Field
          label="Current password"
          hint="The one you signed in with — temporary or otherwise."
        >
          <input
            type={type}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={fieldClass}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="New password" hint="At least 8 characters.">
            <input
              type={type}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type={type}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="size-4 rounded accent-[var(--color-brand-600)] cursor-pointer"
          />
          {/* A password read down a phone line and typed into a masked
              box is the other half of "can't change my password". */}
          <span className="text-[13px]">Show passwords</span>
        </label>

        <Button
          variant="secondary"
          onClick={submit}
          disabled={pending || !current || !password || !confirm}
        >
          {pending ? "Updating…" : "Change password"}
        </Button>
      </div>
    </Card>
  );
}
