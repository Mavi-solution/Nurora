"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div>
        <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
        <p className="text-[14px] text-muted mt-2 max-w-sm">
          {error.message || "An unexpected error occurred."}
        </p>
        <div className="mt-7">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
