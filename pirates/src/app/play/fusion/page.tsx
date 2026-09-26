import type { Metadata } from "next";
import { FusionScreen } from "@/components/fusion/FusionScreen";

export const metadata: Metadata = { title: "Fusion Vision" };

export default function FusionPage() {
  return <FusionScreen />;
}
