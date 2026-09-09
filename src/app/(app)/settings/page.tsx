import { isAdmin, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { PasswordCard } from "./password-card";
import { SettingsForm } from "./settings-form";
import { TeamRoles } from "./team-roles";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { profile } = await requireSession();

  let people: Profile[] = [];
  if (isAdmin(profile)) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("role")
      .order("full_name");
    people = (data ?? []) as Profile[];
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-[13px] text-muted mt-0.5">
          Your profile, rates and how reminders reach you.
        </p>
      </div>

      <SettingsForm profile={profile} />

      <PasswordCard />

      {isAdmin(profile) && <TeamRoles people={people} currentUserId={profile.id} />}
    </div>
  );
}
