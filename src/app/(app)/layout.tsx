import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
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
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <div className="min-h-dvh">
      <AppNav profile={session.profile} unreadCount={count ?? 0} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 lg:px-8 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
