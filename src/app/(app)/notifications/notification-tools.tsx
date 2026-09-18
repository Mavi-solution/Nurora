"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button } from "@/components/ui";
import {
  clearNotifications,
  markAllNotificationsRead,
} from "@/lib/actions/notifications";

/**
 * Bulk controls for the notification list.
 *
 * Two separate actions, because they are not the same decision.
 * "Mark all read" silences the badge and keeps the record; "Clear all"
 * throws the record away and is confirmed, since a booking
 * confirmation is sometimes the only place a desk has written down that
 * a message went out.
 */
export function NotificationTools({
  total,
  unread,
}: {
  total: number;
  unread: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setConfirming(false);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  if (total === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {unread > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => run(markAllNotificationsRead)}
          >
            Mark all read
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => clearNotifications({ onlyRead: true }))}
        >
          Clear read
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          Clear all
        </Button>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear all notifications?"
        footer={
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep them
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={pending}
              onClick={() => run(() => clearNotifications())}
            >
              {pending ? "Clearing…" : `Clear ${total}`}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted leading-relaxed">
          All {total} of them go, including {unread > 0 ? `the ${unread} unread` : "read ones"}.
          This only clears your own list — nothing is cancelled, and the
          sessions and messages themselves are untouched.
        </p>
      </Dialog>
    </>
  );
}
