# Word data sources

`public/lexicon.txt`, `data/words.json` and `data/puzzles.json` are generated from these lists
(`npm run data:fetch && npm run data:all`). The raw downloads live in `data/raw/` and are not committed.

## ENABLE (validity)

*Enhanced North American Benchmark Lexicon* (`enable1.txt`), the classic word-game dictionary.
Released into the public domain. Decides which words are valid.

## SCOWL 2020.12.07 (familiarity)

*Spell Checker Oriented Word Lists* by Kevin Atkinson — <http://wordlist.aspell.net/>.
Its size levels (10 = most common … 95 = rarest) become the familiarity tiers.

> Copyright 2000-2018 by Kevin Atkinson
>
> Permission to use, copy, modify, distribute and sell these word lists, the associated
> scripts, the output created from the scripts, and its documentation for any purpose is
> hereby granted without fee, provided that the above copyright notice appears in all copies
> and that both that copyright notice and this permission notice appear in supporting
> documentation. Kevin Atkinson makes no representations about the suitability of this array
> for any purpose. It is provided "as is" without express or implied warranty.

SCOWL incorporates public-domain data from Moby Words II and 12Dicts (Alan Beale); see the
`Copyright` file in the SCOWL distribution for the full notices.

## List of Dirty, Naughty, Obscene, and Otherwise Bad Words (filtering)

<https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>, CC BY 4.0.
Used only to keep words out of puzzles (tier `x`). Slurs in `data/blocklist.json` are removed entirely.
