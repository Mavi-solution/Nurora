"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import { changePassword } from "@/lib/actions/profile";

/** Counsellors are set up with a temporary password; this replaces it. */
export function PasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setDone(false);

    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");

    startTransition(async () => {
      const result = await changePassword(password);
      if (!result.ok) return setError(result.error);
      setPassword("");
      setConfirm("");
      setDone(true);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Password"
        description="If the practice set you up, replace the temporary password here."
      />
      <div className="px-5 py-4 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {done && <Alert tone="success">Password changed.</Alert>}

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="New password" hint="At least 8 characters.">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
        </div>

        <Button
          variant="secondary"
          onClick={submit}
          disabled={pending || !password || !confirm}
        >
          {pending ? "Updating…" : "Change password"}
        </Button>
      </div>
    </Card>
  );
}
