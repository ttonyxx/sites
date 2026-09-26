import type { Metadata } from "next";
import { Suspense } from "react";
import { SprintScreen } from "@/components/sprint/SprintScreen";

export const metadata: Metadata = { title: "Steal Sprint" };

export default function SprintPage() {
  return (
    <Suspense>
      <SprintScreen />
    </Suspense>
  );
}
