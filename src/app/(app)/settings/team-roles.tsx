"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Avatar, Card, CardHeader } from "@/components/ui";
import { setUserRole } from "@/lib/actions/profile";
import type { Profile, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["client", "counsellor", "admin"];

export function TeamRoles({
  people,
  currentUserId,
}: {
  people: Profile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(userId: string, role: UserRole) {
    setError(null);
    startTransition(async () => {
      const result = await setUserRole(userId, role);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="People"
        description="Anyone who has signed in. Promote a counsellor to give them a lane on the schedule."
      />
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <ul className="divide-y divide-[var(--border)]">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-3 px-5 py-3.5">
            <Avatar name={person.full_name || "?"} url={person.avatar_url} size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium truncate">
                {person.full_name || "Unnamed"}
                {person.id === currentUserId && (
                  <span className="text-[12px] text-muted font-normal"> · you</span>
                )}
              </p>
              <p className="text-[12px] text-muted truncate">
                {person.email ?? person.phone ?? "No contact details"}
              </p>
            </div>
            <select
              value={person.role}
              disabled={pending || person.id === currentUserId}
              onChange={(e) => change(person.id, e.target.value as UserRole)}
              aria-label={`Role for ${person.full_name}`}
              className="rounded-full border border-hairline bg-card px-3 py-1.5 text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </Card>
  );
}
