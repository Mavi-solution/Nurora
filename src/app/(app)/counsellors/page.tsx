import { redirect } from "next/navigation";
import { Avatar, Card, EmptyState, Pill } from "@/components/ui";
import { ButtonLink } from "@/components/ui";
import { canManagePractice, requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Specialism } from "@/lib/types";
import { NewCounsellorButton } from "./new-counsellor";

export const metadata = { title: "Counsellors" };
export const dynamic = "force-dynamic";

export default async function CounsellorsPage() {
  const { profile } = await requireStaff();
  if (!canManagePractice(profile)) redirect("/schedule");

  const supabase = await createClient();

  const [{ data: counsellorRows }, { data: specialismRows }, { data: links }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("role", "counsellor")
        .order("is_active", { ascending: false })
        .order("full_name"),
      supabase.from("specialisms").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("counsellor_specialisms").select("counsellor_id, specialism_id"),
    ]);

  const counsellors = (counsellorRows ?? []) as Profile[];
  const specialisms = (specialismRows ?? []) as Specialism[];
  const specialismById = new Map(specialisms.map((s) => [s.id, s]));

  const skillsByCounsellor = new Map<string, Specialism[]>();
  for (const link of links ?? []) {
    const s = specialismById.get(link.specialism_id as string);
    if (!s) continue;
    const list = skillsByCounsellor.get(link.counsellor_id as string) ?? [];
    list.push(s);
    skillsByCounsellor.set(link.counsellor_id as string, list);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Counsellors
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            {counsellors.filter((c) => c.is_active).length} taking bookings · what
            they specialise in and the languages they work in
          </p>
        </div>
        <div className="flex-1" />
        <NewCounsellorButton specialisms={specialisms} defaultTimezone={profile.timezone} />
      </div>

      <Card>
        {counsellors.length === 0 ? (
          <EmptyState
            title="No counsellors yet"
            description="Add your first counsellor — they get a login, and you can set their working hours straight after."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {counsellors.map((c) => {
              const skills = skillsByCounsellor.get(c.id) ?? [];
              return (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.full_name} url={c.avatar_url} size={40} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-[15px]">{c.full_name}</p>
                        {!c.is_active && <Pill>Not taking bookings</Pill>}
                        {c.is_admin && <Pill>Admin</Pill>}
                      </div>

                      {c.headline && (
                        <p className="text-[13px] text-muted mt-0.5">{c.headline}</p>
                      )}

                      <p className="text-[12px] text-muted mt-1">
                        {[c.email, c.phone].filter(Boolean).join(" · ") ||
                          "No contact details"}
                      </p>

                      {skills.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {skills.map((s) => (
                            <Pill key={s.id}>{s.name}</Pill>
                          ))}
                        </div>
                      )}

                      {c.languages.length > 0 && (
                        <p className="text-[12px] text-muted mt-2">
                          Speaks {c.languages.join(", ")}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[14px] font-medium tabular-nums">
                        {formatMoney(c.default_session_fee_cents, c.currency)}
                      </p>
                      <p className="text-[12px] text-muted">
                        {c.default_duration_minutes} min
                      </p>
                      <ButtonLink
                        href={`/availability?counsellor=${c.id}`}
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                      >
                        Hours
                      </ButtonLink>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
