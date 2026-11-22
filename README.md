# Token Launch Radar

A token launch radar for make.fun's "Build the best token launch radar" bounty: reads a sealed
DefiLlama snapshot, scores every pre-token protocol with the radar-1 implied-value model
(TVL, 7-day momentum, category weight, protocol age, chain quality), ranks 200 candidates, and
renders a static dark dashboard — a ranked board, a per-protocol detail view with a concrete
farm plan, and a working filter. No network, no framework, deterministic.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yogio1/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yogio1/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Writes `out/board.json` (200 rows, the whole 40-protocol watchlist covered), `out/data.js`,
`out/dashboard/`, `out/screenshots/` (board, detail, filtered) and `out/dossier.json`.
