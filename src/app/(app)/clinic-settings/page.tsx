import { redirect } from "next/navigation";
import { loadClinicSettings } from "@/lib/business/clinic-settings";
import { isAdmin, requireStaff } from "@/lib/auth";
import { ClinicSettingsForm } from "./clinic-settings-form";

export const metadata = { title: "Clinic settings" };
export const dynamic = "force-dynamic";

export default async function ClinicSettingsPage() {
  const { profile } = await requireStaff();
  if (!isAdmin(profile)) redirect("/schedule");

  const settings = await loadClinicSettings();
  if (!settings) redirect("/schedule");

  return <ClinicSettingsForm settings={settings} />;
}
