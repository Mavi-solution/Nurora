import { listInterests } from "@/lib/actions/interests";
import { listAppointmentTags } from "@/lib/actions/services";
import { isAdmin, requireStaff } from "@/lib/auth";
import { InterestList } from "./interest-list";

export const metadata = { title: "Interest & Booked" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ status?: string }>;

const STATUSES = ["scheduled", "converted", "dropped"] as const;

export default async function InterestsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;

  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? (params.status as (typeof STATUSES)[number])
    : undefined;

  const [interests, tags] = await Promise.all([
    listInterests(status),
    listAppointmentTags(true),
  ]);

  return (
    <InterestList
      interests={interests}
      tags={tags}
      status={status ?? "all"}
      isAdmin={isAdmin(profile)}
    />
  );
}
