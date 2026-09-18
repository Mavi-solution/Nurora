import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { MigrationBanner } from "@/components/migration-banner";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.onboarded) redirect("/onboarding");

  const supabase = await createClient();
  const [{ count }, { count: dmCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    // RLS scopes this to messages addressed to me.
    supabase
      .from("direct_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", session.userId)
      .is("read_at", null),
  ]);

  return (
    <div className="min-h-dvh">
      <AppNav
        profile={session.profile}
        unreadCount={count ?? 0}
        unreadMessages={dmCount ?? 0}
      />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 lg:px-8 py-6 lg:py-8">
          <MigrationBanner profile={session.profile} />
          {children}
        </div>
      </main>
    </div>
  );
}
