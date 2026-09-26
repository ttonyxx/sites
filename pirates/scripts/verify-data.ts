/**
 * Build gate: re-checks every shipped puzzle and board word with exact letter
 * counts against the lexicon. `npm run build` runs this first and fails on any problem.
 */
import fs from "node:fs";
import path from "node:path";
import { verifyDataset } from "../src/lib/engine/verify";
import { Lexicon } from "../src/lib/engine/lexicon";
import type { Puzzle } from "../src/lib/engine/puzzles";
import type { WordEntry } from "../src/lib/engine/words";

const ROOT = path.join(__dirname, "..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as T;

const lexicon = Lexicon.fromText(fs.readFileSync(path.join(ROOT, "public", "lexicon.txt"), "utf8"));
const report = verifyDataset(read<Puzzle[]>("data/puzzles.json"), read<WordEntry[]>("data/words.json"), lexicon);

if (report.problems.length) {
  console.error(`✗ ${report.problems.length} data problem(s):`);
  for (const p of report.problems.slice(0, 50)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ verified ${report.puzzles} puzzles and ${report.words} board words against ${lexicon.size.toLocaleString()} lexicon words`);
