import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/lib/types";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const notifications = (data ?? []) as Notification[];

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-[13px] text-muted mt-0.5">
          Session reminders arrive three days before each appointment.
        </p>
      </div>

      <Card>
        {notifications.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="Reminders for upcoming sessions will appear here, and by email or WhatsApp."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {notifications.map((n) => {
              const content = (
                <div className="px-5 py-4 hover:bg-card-muted transition-colors">
                  <div className="flex items-start gap-3">
                    {!n.read_at && (
                      <span className="mt-1.5 size-2 rounded-full bg-brand-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{n.title}</p>
                      <p className="text-[13px] text-muted mt-1 leading-relaxed">{n.body}</p>
                      <p className="text-[12px] text-faint mt-1.5">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              );

              return (
                <li key={n.id}>
                  {n.appointment_id ? (
                    <Link href={`/appointments/${n.appointment_id}`}>{content}</Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
