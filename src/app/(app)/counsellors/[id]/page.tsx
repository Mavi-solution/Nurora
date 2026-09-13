import { notFound, redirect } from "next/navigation";
import { loadPermissions } from "@/lib/actions/settings-admin";
import { canManagePractice, isAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Benefit, Profile, Specialism } from "@/lib/types";
import { CounsellorEditor } from "./counsellor-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.full_name ?? "Counsellor" };
}

export default async function CounsellorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireStaff();
  if (!canManagePractice(profile)) redirect("/schedule");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: counsellor }, { data: specialisms }, { data: links }, { data: stats }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase.from("specialisms").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("counsellor_specialisms").select("specialism_id").eq("counsellor_id", id),
      supabase
        .from("appointments")
        .select("id, status")
        .eq("counsellor_id", id)
        .limit(1000),
    ]);

  if (!counsellor) notFound();

  // Absent row means everything is on, so this always returns a full set.
  const permissions = await loadPermissions(id);
  const { data: benefits } = await supabase
    .from("benefits")
    .select("*")
    .eq("counsellor_id", id)
    .order("granted_on", { ascending: false });

  const appointments = stats ?? [];

  return (
    <CounsellorEditor
      counsellor={counsellor as Profile}
      specialisms={(specialisms ?? []) as Specialism[]}
      selectedSpecialismIds={(links ?? []).map((l) => l.specialism_id as string)}
      // Only an admin may change roles, admin rights or passwords —
      // reception manages the diary, not who can do what.
      viewerIsAdmin={isAdmin(profile)}
      viewerId={profile.id}
      permissions={permissions}
      benefits={(benefits ?? []) as Benefit[]}
      appointmentCount={appointments.length}
      upcomingCount={appointments.filter((a) => a.status === "scheduled").length}
    />
  );
}
