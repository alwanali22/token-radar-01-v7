# Token Radar — token-radar-01-v7

[![make.fun competition](https://make.fun/api/competitions/token-radar-01/badge)](https://make.fun/competitions/token-radar-01)
[![make.fun rank](https://make.fun/api/repos/alwanali22/token-radar-01-v7/rank/badge)](https://make.fun/competitions/token-radar-01)
[![make.fun reward](https://make.fun/api/repos/alwanali22/token-radar-01-v7/reward/badge)](https://make.fun/competitions/token-radar-01)

Token Radar ranks 198 unlaunched DeFi protocols by the market cap they would plausibly reach if they launched a token, then prices a concrete farm plan for each one. Snapshot 2026-11-14: 758 protocols, watchlist 40, floor $50M TVL.

## Model (v7, L1HC)

- **Implied value** = TVL × fitted size multiple (infra intercept) × growth × maturity × launch odds. No pre-token haircut: no launched/unlaunched pair in this snapshot can fit a discount.
- **Size curve**: log10(mcap/TVL) = 3.3114 − 0.5269·log10(TVL) + 0.4686·[infra], n=128, clamped to [0.02, 0.80].
- **Launch odds**: 12-feature logistic (age, Dexs, Lending, bridge-like, staking-like, CEX, missing-listing flag, log10 TVL, chain count, high-launch-category flag, low-launch-category flag, high-rate-chain flag). Weights [0.500, 0.172, 0.171, −0.126, −0.010, −0.224, 0.362, 0.187, 0.145, 0.220, −0.520, 0.412], bias 0.233.
- **Range**: implied × 10^(±0.6745 × residual SD), residual SD 0.8983.
- **Farm plan**: $2,000 deposit, 10% airdrop share, 90-day horizon, 4.5% T-bill, 2.7 h per plan. FARM needs net ≥ $25 and net/h ≥ $10.

## Verified numbers

```
rows=198 top=polymarket-international implied=51890820 wf2024=2.66 brier=0.1933 holds=54.9 farm=14
```

Checksum `e874c179`. Verdicts FARM 14 / MARGINAL 40 / THIN 94 / SKIP 50. Brier CV 0.1933 (train-only CV 0.1978), holdout 0.1865, base 0.2476. Two fresh runs produce byte-identical `board.json` and `data.js`. The dashboard recomputes all 198 rows live in the browser and agrees 198/198.

## Run it

```sh
bun main.ts --input <snapshot-dir> --output <outdir>
```

Needs Bun (or Node 22+ with type stripping). Inputs: `snapshot.json` with `as_of`, `watchlist` (40 slugs) and `protocols`. Outputs: `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`.

## Layout

- `main.ts` — CLI, gates, serialization
- `lib/model.ts` — size curve, odds model, value/farm math, backtests
- `dashboard/` — `model.js` (browser port of the model), `app.js`, `index.html`, `app.css`
- `vendor/makefun-board.ts` — dossier builder (vendored, unmodified)
- `screenshots/` — board, detail dialog, model panel at 1440×900

## Honest limits

Calibration improved (worst category gap 0.236 → 0.138) but is not solved: Dexs is still under-predicted by 0.138. Polymarket's 0.824 odds are driven mostly by the Polygon high-rate-chain flag (+0.412), one chain effect. Farm verdicts are slice-sensitive: at a $1,000 deposit the board has 0 FARM rows; rank 1 Polymarket is only MARGINAL as a farm. The value backtest still misses by roughly 3× out of sample — the range column is the honest number.

## License

MIT. See `LICENSE`.
