import { redirect } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CounsellorSummary } from "@/lib/types";
import { ClientBookingForm } from "./booking-form";

export const metadata = { title: "Book a session" };
export const dynamic = "force-dynamic";

export default async function BookPage() {
  const { profile, userId } = await requireSession();
  if (profile.role !== "client") redirect("/schedule");

  const supabase = await createClient();

  const { data: clientRecord } = await supabase
    .from("clients")
    .select("id, counsellor_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: counsellorRows } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency")
    .eq("role", "counsellor")
    .eq("is_active", true)
    .order("full_name");

  const counsellors = (counsellorRows ?? []) as CounsellorSummary[];

  if (!clientRecord) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight mb-6">
          Book a session
        </h1>
        <Card>
          <EmptyState
            title="No client record linked yet"
            description="Your practice needs to add you as a client before you can book. Once they do — using this email or phone — booking unlocks here."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Book a session</h1>
        <p className="text-[13px] text-muted mt-0.5">
          Times are shown in {profile.timezone}.
        </p>
      </div>

      <ClientBookingForm
        clientId={clientRecord.id}
        counsellors={counsellors}
        preferredCounsellorId={clientRecord.counsellor_id ?? undefined}
        timezone={profile.timezone}
      />
    </div>
  );
}
