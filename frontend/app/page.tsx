// Server component shell. `useSearchParams` (used inside Dashboard) must sit
// under a <Suspense> boundary in Next 15 — otherwise the whole route is
// forced dynamic and the build warns. This is the standard pattern.

import { Suspense } from "react";

import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
          loading desk…
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
