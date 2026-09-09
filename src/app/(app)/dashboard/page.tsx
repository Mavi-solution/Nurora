import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

/** Post-login landing: send people to the surface that fits their role. */
export default async function DashboardPage() {
  const { profile } = await requireSession();
  redirect(profile.role === "client" ? "/my" : "/schedule");
}
