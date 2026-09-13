import { loadBric } from "@/lib/actions/bric";
import { requireStaff } from "@/lib/auth";
import type { BricTab } from "@/lib/types";
import { BricBoard } from "./bric-board";

export const metadata = { title: "BRIC" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string; from?: string; to?: string }>;

const TABS: BricTab[] = ["booked", "reschedule", "interest", "cancelled"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function BricPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireStaff();
  const params = await searchParams;

  const tab = TABS.includes(params.tab as BricTab)
    ? (params.tab as BricTab)
    : "booked";

  // Default to the last 30 days through the next 30 — the window a desk
  // actually looks at, since Booked is mostly forward-looking while
  // Cancelled is mostly behind.
  const now = new Date();
  const from =
    params.from && DATE.test(params.from)
      ? params.from
      : dayKey(new Date(now.getTime() - 30 * 86400000));
  const to =
    params.to && DATE.test(params.to)
      ? params.to
      : dayKey(new Date(now.getTime() + 30 * 86400000));

  const { rows, canSeeContacts } = await loadBric(tab, { from, to });

  return (
    <BricBoard
      tab={tab}
      rows={rows}
      canSeeContacts={canSeeContacts}
      from={from}
      to={to}
    />
  );
}
