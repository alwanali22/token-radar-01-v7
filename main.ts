import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fitSizeCurve,
  sizeMultiple,
  growthMultiplier,
  maturityMultiplier,
  valueIfLaunches,
  fitOddsModel,
  oddsOf,
  residualSd,
  calculateImpliedValue,
  rankable,
  ledgerPartition,
  farmEconomics,
  generateFarmSteps,
  backtestValue,
  backtestOdds,
  bootstrapSlope,
  isInfra,
  ageDays,
  FEE_USD_PER_TX,
  type SnapshotProtocol,
  type Snapshot,
  type BoardRow,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function fail(message: string): never {
  console.error(`token-radar: ${message}`);
  process.exit(1);
}

function readArgs(): { input: string; output: string } {
  const argv = process.argv.slice(2);
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) input = argv[++i];
    else if (arg === '--output' && i + 1 < argv.length) output = argv[++i];
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
    else fail(`unknown argument: ${arg}`);
  }
  if (!input.endsWith('snapshot.json')) input = join(input, 'snapshot.json');
  return { input, output };
}

function loadSnapshot(path: string): Snapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read snapshot at ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text!);
  } catch {
    fail(`snapshot at ${path} is not valid JSON`);
  }
  const snap = parsed as Snapshot;
  if (!snap || typeof snap !== 'object') fail('snapshot is not an object');
  if (!Array.isArray(snap.protocols)) fail('snapshot.protocols is not an array');
  if (!Array.isArray(snap.watchlist)) fail('snapshot.watchlist is not an array');
  if (typeof snap.as_of !== 'string') fail('snapshot.as_of is not a string');
  for (const p of snap.protocols) {
    if (!p || typeof p !== 'object') fail('snapshot holds a protocol that is not an object');
    if (typeof p.slug !== 'string') fail('a protocol has no string slug');
    if (typeof p.name !== 'string') fail(`protocol ${p.slug} has no string name`);
    if (!(p.category === null || typeof p.category === 'string')) {
      fail(`protocol ${p.slug} has a category that is neither a string nor null`);
    }
    if (!Array.isArray(p.chains)) fail(`protocol ${p.slug} has no chains array`);
    if (typeof p.tvl_usd !== 'number') fail(`protocol ${p.slug} has no numeric tvl_usd`);
  }
  return snap;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// FNV-1a 32-bit hex of a string, 8 lowercase hex chars.
function fnv1aHex(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function main(): void {
  const { input, output } = readArgs();
  const snapshot = loadSnapshot(input);
  const asOf = snapshot.as_of;
  const protocols = snapshot.protocols;
  const watchlist = snapshot.watchlist;

  const live = protocols.filter(
    (p) =>
      typeof p.mcap_usd === 'number' &&
      Number.isFinite(p.mcap_usd) &&
      p.mcap_usd > 0 &&
      Number.isFinite(p.tvl_usd) &&
      p.tvl_usd > 0,
  );
  const curve = fitSizeCurve(live);
  const oddsModel = fitOddsModel(protocols, asOf);
  const sd = residualSd(live, curve, asOf);
  const valueBt = backtestValue(live, asOf);
  const oddsBt = backtestOdds(protocols, asOf);
  const boot = bootstrapSlope(live);
  const ledger = ledgerPartition(protocols);

  const onWatchlist = new Set(watchlist);
  const watchCandidates = watchlist
    .map((slug) => protocols.find((p) => p.slug === slug))
    .filter((p): p is SnapshotProtocol => p !== undefined && rankable(p));
  const watchSlugs = new Set(watchCandidates.map((p) => p.slug));
  const earlyCandidates = protocols.filter((p) => !watchSlugs.has(p.slug) && rankable(p));
  const candidates = [...watchCandidates, ...earlyCandidates];

  const rows: BoardRow[] = candidates.map((p) => {
    const detail = calculateImpliedValue(p, asOf, curve, oddsModel, sd);
    const farm = farmEconomics(p, detail.implied);
    const steps = generateFarmSteps(p, asOf);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? '',
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(asOf, p.listed_at),
      watchlist: onWatchlist.has(p.slug),
      rank: 0,
      implied_value_usd: detail.implied,
      size_multiple: detail.sizeMultiple,
      growth_mult: detail.growthMult,
      maturity_mult: detail.maturityMult,
      odds: detail.odds,
      value_if_launches: Math.round(detail.valueIfLaunches),
      range_lo: detail.rangeLo,
      range_hi: detail.rangeHi,
      verdict: farm.verdict,
      net_usd: round2(farm.netUsd),
      net_per_hour: round2(farm.netPerHour),
      gas_usd: round2(farm.gasUsd),
      farm_steps: steps,
    };
  });
  rows.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  });
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  // Gates: fail loudly rather than write a board that cannot pass.
  if (rows.length < 100) fail(`only ${rows.length} board rows, need at least 100`);
  if (watchlist.length !== 40) fail(`watchlist holds ${watchlist.length} slugs, need exactly 40`);
  const boardSlugs = new Set(rows.map((r) => r.slug));
  for (const slug of watchlist) {
    if (!boardSlugs.has(slug)) fail(`watchlist slug ${slug} is missing from the board`);
  }
  if (boardSlugs.size !== rows.length) fail('a slug repeats on the board');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rank !== i + 1) fail(`rank ${rows[i].rank} is out of order at position ${i + 1}`);
    if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      fail('implied values rise down the board');
    }
    if (rows[i].farm_steps.length !== 6) fail(`row ${rows[i].slug} has ${rows[i].farm_steps.length} farm steps, need 6`);
    for (const step of rows[i].farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600) {
        fail(`row ${rows[i].slug} has a farm step outside 20-600 characters`);
      }
    }
    if (!(rows[i].odds >= 0.001 && rows[i].odds <= 0.999)) fail(`row ${rows[i].slug} has odds outside [0.001, 0.999]`);
    if (rows[i].range_lo < 1) fail(`row ${rows[i].slug} has range_lo below 1`);
    if (!(rows[i].range_hi > rows[i].range_lo)) fail(`row ${rows[i].slug} has range_hi below range_lo`);
    if (!['FARM', 'MARGINAL', 'THIN', 'SKIP'].includes(rows[i].verdict)) {
      fail(`row ${rows[i].slug} has verdict ${rows[i].verdict}`);
    }
  }
  const setAsideTotal = ledger.setAside.reduce((s, e) => s + e.count, 0);
  if (ledger.ranked + ledger.tokenTrades + setAsideTotal !== protocols.length) {
    fail('ledger parts do not sum to the protocol count');
  }
  const liveSorted = [...live].sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number));
  const liveTop = liveSorted.slice(0, 24);
  if (liveTop.length !== 24) fail(`live list holds ${liveTop.length} entries, need exactly 24`);

  const verdictCounts = { FARM: 0, MARGINAL: 0, THIN: 0, SKIP: 0 };
  for (const row of rows) {
    verdictCounts[row.verdict as keyof typeof verdictCounts] += 1;
  }
  const firstRows = rows.slice(0, 250);
  const checksum = fnv1aHex(JSON.stringify(firstRows));
  const formula =
    'implied = TVL x size multiple (infra intercept) x growth x maturity x launch odds (no haircut); odds add log-TVL + chain count + grouped category flags + high-rate-chain flag; range = implied x 10^(+/-0.6745 x residual SD)';

  const radar = {
    rows: firstRows,
    live: liveTop.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
    })),
    liveAll: liveSorted.map((p) => ({
      slug: p.slug,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      category: p.category,
    })),
    model: {
      as_of: asOf,
      checksum,
      formula,
      curve: {
        intercept: curve.intercept,
        slope: curve.slope,
        infraCoef: curve.infraCoef,
        n: curve.n,
        clampMin: curve.clampMin,
        clampMax: curve.clampMax,
      },
      odds: {
        weights: oddsModel.weights,
        bias: oddsModel.bias,
        means: oddsModel.means,
        sds: oddsModel.sds,
        baseRate: oddsModel.baseRate,
        medianAge: oddsModel.medianAge,
        cvBrier: oddsBt.cvBrier,
        holdoutBrier: oddsBt.holdoutBrier,
        baseBrier: oddsBt.baseBrier,
        ablations: oddsBt.ablations,
      },
      residualSd: sd,
      backtest: {
        value: valueBt,
        odds: oddsBt,
        bootstrap: boot,
      },
      ledger,
      farmAssumptions: {
        depositUsd: 2000,
        horizonDays: 90,
        dropShare: 0.1,
        tbillRate: 0.045,
        hoursPerPlan: 2.7,
        feeUsdPerTx: FEE_USD_PER_TX,
        defaultFeeUsd: 0.5,
        bridgeFeeUsd: 2,
      },
      verdictCounts,
    },
    counts: {
      total: protocols.length,
      watchlist: watchlist.length,
      board: rows.length,
      early: rows.filter((r) => !r.watchlist).length,
      live: liveTop.length,
      excluded: setAsideTotal,
    },
  };

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: firstRows }, null, 2) + '\n', 'utf8');
  writeFileSync(join(output, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`, 'utf8');
  const root = dirname(fileURLToPath(import.meta.url));
  const skipDotfiles = (src: string): boolean => !basename(src).startsWith('.');
  const dashboardSrc = join(root, 'dashboard');
  const shotsSrc = join(root, 'screenshots');
  if (existsSync(dashboardSrc)) cpSync(dashboardSrc, join(output, 'dashboard'), { recursive: true, filter: skipDotfiles });
  if (existsSync(shotsSrc)) cpSync(shotsSrc, join(output, 'screenshots'), { recursive: true, filter: skipDotfiles });

  const wf2024 = valueBt.walkForward[0];
  const farmCount = verdictCounts.FARM;
  const top = rows[0];
  console.log(
    `rows=${rows.length} top=${top.slug} implied=${top.implied_value_usd} ` +
      `wf2024=${wf2024.miss.toFixed(2)} brier=${oddsBt.cvBrier.toFixed(4)} ` +
      `holds=${wf2024.holdsPct.toFixed(1)} farm=${farmCount}`,
  );

  try {
    const dossier = buildDossier(output, { text_max_bytes: 65536 });
    writeFileSync(join(output, 'dossier.json'), dossier);
  } catch (err) {
    fail(`buildDossier failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
