/** Test-only helpers: load the real lexicon and puzzle bank from disk once. */
import fs from "node:fs";
import path from "node:path";
import puzzles from "@data/puzzles.json";
import words from "@data/words.json";
import { Lexicon } from "../engine/lexicon";
import type { Puzzle } from "../engine/puzzles";
import type { WordEntry } from "../engine/words";
import { makeLoose, makeWord, IdGen, type Board } from "../game/board";
import { PuzzleBank } from "../game/bank";

let lexicon: Lexicon | null = null;
let bank: PuzzleBank | null = null;

export function testLexicon(): Lexicon {
  lexicon ??= Lexicon.fromText(fs.readFileSync(path.join(__dirname, "../../../public/lexicon.txt"), "utf8"));
  return lexicon;
}

export function testBank(): PuzzleBank {
  bank ??= new PuzzleBank(puzzles as Puzzle[], words as WordEntry[]);
  return bank;
}

/** Build a board from plain words and loose letters. */
export function boardOf(wordList: string[], loose = ""): Board {
  const ids = new IdGen("t");
  return {
    words: wordList.map((w) => makeWord(ids, w, 0)),
    loose: [...loose].map((l) => makeLoose(ids, l, 0)),
  };
}
