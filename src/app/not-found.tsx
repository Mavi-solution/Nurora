import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div>
        <p className="font-display text-5xl font-semibold">404</p>
        <h1 className="font-display text-xl font-semibold mt-3">
          We couldn&apos;t find that page
        </h1>
        <p className="text-[14px] text-muted mt-2 max-w-sm">
          The link may be stale, or the session may have been cancelled.
        </p>
        <div className="mt-7">
          <ButtonLink href="/dashboard">Back to the schedule</ButtonLink>
        </div>
      </div>
    </main>
  );
}
