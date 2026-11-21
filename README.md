# csv-reader-speed-01-run-20261121-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Fawulana/csv-reader-speed-01-run-20261121-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Fawulana/csv-reader-speed-01-run-20261121-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: `solve.js` answers every case exactly as csv-reader does — same `{columns, rows, errors}`, same broken-row policy — but reads with slices and native scans instead of one character at a time: plain records are split in native code, unquoted fields are sliced out in one go, and quoted fields jump from quote to quote with `indexOf`, with a character loop only for fields that actually hold a line break inside their quotes.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`) and writes the answers to `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`). Node 22 or later, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fawulan&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
