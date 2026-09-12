import { redirect } from "next/navigation";
import { listAppointmentTags, listServices } from "@/lib/actions/services";
import { isAdmin, requireStaff } from "@/lib/auth";
import { ServicesAdmin } from "./services-admin";

export const metadata = { title: "Services & pricing" };
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const { profile } = await requireStaff();
  // Prices and tag labels are clinic-wide configuration: admin only.
  if (!isAdmin(profile)) redirect("/schedule");

  const [services, tags] = await Promise.all([
    listServices(true),
    listAppointmentTags(true),
  ]);

  return <ServicesAdmin services={services} tags={tags} />;
}
