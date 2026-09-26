import type { Metadata } from "next";
import { AnagramScreen } from "@/components/anagram/AnagramScreen";

export const metadata: Metadata = { title: "Raw Anagrams" };

export default function AnagramPage() {
  return <AnagramScreen />;
}
