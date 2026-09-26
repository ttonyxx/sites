# Pirates Blitz

An arcade trainer for **Pirates**, the anagram-stealing word game: flip letters, make words, and steal words by
rearranging them with more letters. The skill that wins is *seeing the steal*. This site drills it with a chess-puzzle
loop: a messy board, a clock, instant feedback, and a spaced-repetition deck of everything you missed.

Live at **[tonyxin.com/sites/pirates](https://tonyxin.com/sites/pirates/)**.

| Mode | What it trains |
| --- | --- |
| **Steal Sprint** (primary) | 60s on a living board. Combine board words and pool letters into new words; the board refills, letters flip in, a rival grabs steals you leave too long. |
| **Fusion Vision** | 10 boards, each hiding exactly one two-word fusion (COOP + AGREE → COOPERAGE). |
| **Raw Anagrams** | 7 letters, 30 seconds, as many words as you can. |
| **Review Mistakes** | Every missed steal, re-served with a light spaced-repetition priority. |

## Run it

```bash
npm install
npm run dev          # http://localhost:3000/sites/pirates/  (the basePath matches production)
npm run check        # typecheck + lint + tests
npm run build        # verifies every puzzle, then static-exports to out/
```

Deployment is automatic: merging to `main` runs the repo-level workflow, which builds this folder with
`SITE_BASE_PATH=/sites/pirates` and publishes `out/` to GitHub Pages (see the root README).

## Architecture

```
src/
  lib/
    engine/        pure word logic (no React)
      letters.ts     signatures: getSignature, combineSignatures, subtractLetters, canCombine, letterDiff
      lexicon.ts     dictionary + familiarity tiers + signature index; front-coded text format
      puzzles.ts     Puzzle type, exact-letter validation, "must rearrange" rule, difficulty model
    game/          game rules (no React)
      board.ts       tiles with stable ids, words, pool, selection
      resolve.ts     "which pieces make this typed word?" (selection is a hint, not a requirement)
      opportunities.ts  every steal available on a board (for guarantees + missed-steal reports)
      sprint.ts      Steal Sprint engine: planting, pool flips, rival, adaptive difficulty, results
      fusion.ts      Fusion Vision boards (exactly one familiar fusion) + session
      anagram.ts     Raw Anagrams racks and checking
      scoring.ts     every scoring rule
      layout.ts      scatter layout: never overlaps, never moves existing words
      bank.ts        puzzle selection by difficulty/type, distractors
    progress/      player progression (pure)
      ratings.ts     puzzle-style skill ratings (not PvP Elo)
      xp.ts streak.ts achievements.ts review.ts
      player.ts      applySession(): the one place a finished game changes stats/ratings/XP/streak/deck
    storage/       persistence behind interfaces
      kv.ts          KeyValueStore (localStorage, memory fallback)
      player-repository.ts  PlayerRepository — swap for Supabase later
      player-store.ts       React binding (useSyncExternalStore), cross-tab sync
  components/      presentation only (tiles, board, HUD, screens)
  app/             routes: /, /play/sprint, /play/fusion, /play/anagram, /review, /stats
scripts/           data pipeline (fetch → lexicon → puzzles → verify)
data/              generated words.json + puzzles.json, curated classics, blocklist
public/lexicon.txt the full dictionary, loaded at runtime
```

Everything under `lib/` is framework-free and unit-tested; components never touch `localStorage` directly.

## The word engine

Every word reduces to a sorted-letter **signature** (`COOPERAGE → aceegoopr`). A steal is valid when the
signatures of the source words plus loose letters merge into exactly the target's signature: nothing missing, nothing
extra. Pirates' rearrangement rule rejects answers that just extend a word (STORE + S → STORES) or glue words
together (BATH + ROOM).

## Puzzle generation

1. **Lexicon** (`npm run data:lexicon`): ENABLE (public domain) decides validity; SCOWL size levels become
   familiarity tiers 0–5; a blocklist removes slurs and keeps crude words out of puzzles. The output is front-coded
   to ~360 KB gzipped.
2. **Puzzles** (`npm run data:puzzles`): for every familiar target word, enumerate the sub-multisets of its letters
   and look them up in a signature index of board-worthy words:
   - `steal`: target − 1–2 letters = one source word
   - `fusion`: target − source A = source B
   - `fusion-plus`: target − A − 1 letter = B
   - `triple`: target − A − B = C

   Candidates are scored for quality (familiar words, genuinely rearranged, not plurals) and **difficulty** (length,
   number of sources, loose letters, target familiarity, how scrambled it is, how many answers exist). Board size and
   distractor similarity are added at play time. Then a balanced, diverse set is kept: ~3,300 puzzles across 4 types
   × 4 bands (Easy/Medium/Hard/Insane), plus `data/curated.json` classics such as FADE + LITERS → FEDERALIST.
3. **Verification** (`npm run data:verify`, run before every build, and again in the browser at startup): each
   shipped puzzle is re-checked with exact letter counts against the lexicon. Any failure fails the build.

Adaptive difficulty: Steal Sprint plants puzzles near a cursor that starts at your rating and moves with every
steal (+), miss (−), and wrong answer (−).

## Data sources

See [`data/SOURCES.md`](data/SOURCES.md): ENABLE (public domain), SCOWL (© Kevin Atkinson, permissive), and the
LDNOOBW list (CC BY 4.0).
