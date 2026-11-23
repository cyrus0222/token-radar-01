# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cyrus0222/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cyrus0222/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every protocol the snapshot records without a token, ranked by what its token would be worth if it launched at its launched peers' prices. 197 rows: the 40-protocol watchlist (TVL ≥ $50M, no token on record) plus 157 early finds below that floor. Total implied value $6.08B on the 2026-11-14 snapshot.

## Run it

```sh
node main.ts --input /input/snapshot.json
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=r7t3ytfs&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## What it does

`main.ts` (Node 22+, standard library only, no network) writes `board.json` (the ranked board), `data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`. Two runs write identical bytes.

## The model — radar-2

`lib/model.ts` holds the whole model; `dashboard/app.js` re-implements it in the browser and recomputes every row, so the page and `board.json` agree.

- **Who is ranked.** A protocol the snapshot records without a token (no market cap, no Gecko id, no symbol) that is not a wrapped, staked or bridged product of a token that already trades. The board applies the watchlist's own rule to every row: no Bridge / Canonical Bridge / Cross Chain Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX category, no `wrapped`, `staked` or `staking` in a name, no exchange's product, no versioned pool.
- **Peer multiple.** Per category, the median market-cap-to-TVL of the launched protocols in that category (128 peers, global median ×0.21), shrunk toward the global median with weight 8 and clamped to [×0.05, ×1.25]. Categories with no peers use the global median.
- **Implied value** = TVL × peer multiple × growth × maturity. Growth = 1 + clamp(7d change, −50%, +100%) × 0.5. Maturity = 0.6 + age/3y × 0.4 (unknown age counts as 1y). Every factor is visible in the detail view.
- **Launch odds** = 0.30 + 0.40 × age factor + 0.30 × log-size factor ($5M → $5B). A score from age and size, not a forecast.
- **Airdrop estimate** = implied value × 7% community share × (farm capital / TVL) × launch odds.
- **Farm plans.** Six steps per row, all computed: capital tier by TVL ($250/$150/$100/$50), hold days by age (60/45/30), gas by the protocol's first chain, a category-specific action (30 categories), and a step that states the airdrop estimate and the gas it costs to claim it.

## The dashboard

`dashboard/index.html` + `app.css` + `app.js` (44 KB total, no network; system fonts only). Sortable and filterable board (search, category, chain, scope, pre-token / live tabs, nine sortable columns), a detail dialog for every protocol with the full model breakdown and farm plan, a live-token table priced by mcap/TVL, and a model section that states the formula, the peer multiples and what the model does not do. State lives in the URL hash, so any view deep-links.

## Layout

```
main.ts                  entrypoint: read snapshot, write board, data, dossier
lib/model.ts             the model, the board builder, the farm plans
vendor/makefun-board.ts  the house's dossier builder (copied from the starter)
dashboard/               index.html, app.css, app.js
screenshots/             1-board.png, 2-detail.png, 3-filtered.png (1440x900)
```

## Checks

`../tools/check.mjs` (outside the repo) replicates the gate's seven checks — dashboard files, board file, sorted by value, watchlist coverage, farm steps, screenshots, dossier byte-identical — plus page/model agreement on all 197 rows and determinism across two runs. All pass on the dev snapshot.

## Caveats

- Implied value is a model, not a promise: it prices a launch that may never happen, from peers that may not resemble the protocol.
- A protocol the snapshot records without a token may still have one its DefiLlama record does not carry; the board says a protocol records no token, never that it has none.
- The snapshot is frozen at 2026-11-14; prices, TVL and launches have moved since.
