import { redirect } from "next/navigation";
import { listTemplates } from "@/lib/actions/messaging";
import { isAdmin, requireStaff } from "@/lib/auth";
import { whatsappStatus } from "@/lib/notify/sms";
import { MessagesAdmin } from "./messages-admin";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const { profile } = await requireStaff();
  if (!isAdmin(profile)) redirect("/schedule");

  const templates = await listTemplates();
  const whatsapp = whatsappStatus();

  return (
    <MessagesAdmin
      templates={templates}
      whatsappReady={whatsapp.connected}
      whatsappProblems={[...whatsapp.missing, ...whatsapp.malformed].map(
        (name) => `${name}: ${whatsapp.detail[name]}`,
      )}
    />
  );
}
