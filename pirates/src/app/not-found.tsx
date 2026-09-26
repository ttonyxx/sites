import Link from "next/link";
import { TileWord } from "@/components/tiles/TileWord";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="flex flex-col items-center gap-6">
        <TileWord word="lost" size={48} jitter />
        <p className="text-muted">That page walked the plank.</p>
        <Link href="/" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink">
          Back to port
        </Link>
      </div>
    </main>
  );
}
