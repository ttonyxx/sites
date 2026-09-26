/**
 * Letter-multiset utilities — the core of the whole game.
 *
 * Every word reduces to a canonical *signature*: its lowercase letters sorted
 * alphabetically ("COOPERAGE" → "aceegoopr"). Two words are exact anagrams iff
 * their signatures match, and "using exactly these letters" is just signature
 * arithmetic: combining words merges signatures, removing letters subtracts them.
 *
 * All functions accept any casing and ignore non a–z characters.
 */

export type Signature = string;

const A = 97; // "a"

/** Lowercase and strip everything that isn't a–z. */
export function normalizeWord(input: string): string {
  return input.toLowerCase().replace(/[^a-z]/g, "");
}

/** Canonical sorted-letter signature. getSignature("COOPERAGE") === "aceegoopr". */
export function getSignature(word: string): Signature {
  const w = normalizeWord(word);
  if (w.length < 2) return w;
  return w.split("").sort().join("");
}

/** True when both words use exactly the same letters, the same number of times. */
export function areExactAnagrams(a: string, b: string): boolean {
  return getSignature(a) === getSignature(b);
}

/** Merge two already-sorted signatures into one sorted signature (linear time). */
function mergeTwo(a: Signature, b: Signature): Signature {
  if (!a) return b;
  if (!b) return a;
  let out = "";
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j]) out += a[i++];
    else out += b[j++];
  }
  return out + a.slice(i) + b.slice(j);
}

/** Combine signatures (e.g. two words plus loose letters) into one signature. */
export function combineSignatures(...signatures: Signature[]): Signature {
  let out = "";
  for (const s of signatures) out = mergeTwo(out, s);
  return out;
}

/** Signature of several words' letters pooled together. */
export function combineWords(...words: string[]): Signature {
  return combineSignatures(...words.map(getSignature));
}

/**
 * Remove `remove`'s letters from `from`, respecting multiplicity.
 * Returns the remaining letters as a signature, or `null` if `from`
 * doesn't contain every letter of `remove` (enough times).
 *
 * subtractLetters("cooperage", "coop") === "aeegr"
 * subtractLetters("coop", "cop") === "o"
 * subtractLetters("cop", "coop") === null
 */
export function subtractLetters(from: string, remove: string): Signature | null {
  const a = getSignature(from);
  const b = getSignature(remove);
  let out = "";
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    if (j < b.length && a[i] === b[j]) {
      j++;
    } else if (j < b.length && b[j] < a[i]) {
      return null; // b needs a letter that a doesn't have (enough of)
    } else {
      out += a[i];
    }
  }
  return j === b.length ? out : null;
}

/** True when every letter of `needle` is available in `haystack` (with multiplicity). */
export function containsLetters(haystack: string, needle: string): boolean {
  return subtractLetters(haystack, needle) !== null;
}

/**
 * The exact-usage rule: do these source words (plus optional loose letters)
 * use precisely the letters of `target` — nothing missing, nothing extra?
 *
 * canCombine(["coop", "agree"], "cooperage") === true
 * canCombine(["irate", "vial"], "varietal") === false  // one "i" too many
 */
export function canCombine(words: readonly string[], target: string, loose = ""): boolean {
  return combineSignatures(...words.map(getSignature), getSignature(loose)) === getSignature(target);
}

/**
 * Compare what you have with what you tried to spell.
 * `missing`: letters the attempt needs but `have` lacks.
 * `extra`: letters in `have` that the attempt left unused.
 */
export function letterDiff(have: string, attempt: string): { missing: Signature; extra: Signature } {
  const a = getSignature(have);
  const b = getSignature(attempt);
  let missing = "";
  let extra = "";
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) extra += a[i++];
    else if (i >= a.length || b[j] < a[i]) missing += b[j++];
    else {
      i++;
      j++;
    }
  }
  return { missing, extra };
}

/** Per-letter counts, index 0 = "a". */
export function letterCounts(word: string): Uint8Array {
  const counts = new Uint8Array(26);
  const w = normalizeWord(word);
  for (let i = 0; i < w.length; i++) counts[w.charCodeAt(i) - A]++;
  return counts;
}

/** Signature from a counts vector (inverse of letterCounts). */
export function countsToSignature(counts: ArrayLike<number>): Signature {
  let out = "";
  for (let c = 0; c < 26; c++) {
    if (counts[c] > 0) out += String.fromCharCode(A + c).repeat(counts[c]);
  }
  return out;
}

/**
 * Every distinct sub-multiset of a signature, as signatures, with length in
 * [minLength, maxLength]. "aab" → "", "a", "aa", "b", "ab", "aab" (dedup'd by construction).
 */
export function subSignatures(signature: Signature, minLength = 0, maxLength = signature.length): Signature[] {
  const letters: string[] = [];
  const counts: number[] = [];
  for (const ch of signature) {
    if (letters[letters.length - 1] === ch) counts[counts.length - 1]++;
    else {
      letters.push(ch);
      counts.push(1);
    }
  }
  const out: Signature[] = [];
  const walk = (idx: number, acc: string) => {
    if (acc.length > maxLength) return;
    if (idx === letters.length) {
      if (acc.length >= minLength) out.push(acc);
      return;
    }
    for (let k = 0; k <= counts[idx]; k++) walk(idx + 1, acc + letters[idx].repeat(k));
  };
  walk(0, "");
  return out;
}

/** Length of the longest common contiguous substring (used for "how scrambled is it"). */
export function longestCommonSubstring(a: string, b: string): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}
