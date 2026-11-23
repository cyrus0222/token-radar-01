// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol the snapshot records without a token that the radar may rank:
// the 40-protocol watchlist is the floor, and the rankable pre-token protocols below it are the
// early finds the radar exists to surface. A protocol is rankable when it records no token and is
// not a wrapped, staked or bridged product of a token that already trades: the house's own
// watchlist rule, applied to the whole board. WBTC, Binance staked ETH and USDT0 are wrapped or
// staked products of tokens that trade, so they are not launches to price, whatever their TVL.
// Live-token protocols are never ranked either: they are the market's own evidence, set aside in
// the dashboard's Live view, and they price the model itself.
//
// Implied value follows only from the snapshot's own figures:
//
//   peer multiple  = the category's launched peers' median market-cap-to-TVL, shrunk toward the
//                    global median with weight 8 (small categories lean on the market, big ones
//                    speak for themselves), clamped to [0.05, 1.25]
//   base           = tvl_usd x peer multiple
//   growthMult     = 1 + clamp(change_7d, -50, 100) / 100 x 0.5
//   maturityMult   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied        = max(1, round(base x growthMult x maturityMult))
//
// Two more figures ride on the same inputs, and the dashboard shows both beside every value:
//   launch odds    = 0.30 + 0.40 x min(age_days, 1095) / 1095 + 0.30 x size factor, where the size
//                    factor runs 0 at $5M of TVL to 1 at $5B on a log scale: older and larger
//                    protocols have had more time and more reason to launch
//   expected value = implied x launch odds
//   airdrop est.   = implied x 7% community allocation x (farm capital / tvl_usd) x launch odds:
//                    the pro-rata floor of a farmer's share if the drop were split by TVL share,
//                    stated as an estimate, never a promise.
//
// No protocol name is ever special-cased: the same functions score every row, and the dashboard
// recomputes each row from the same figures and checks the number board.json carries.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_shrink_k: number;
  peer_multiple_min: number;
  peer_multiple_max: number;
  odds_base: number;
  odds_age_weight: number;
  odds_size_weight: number;
  odds_size_floor_usd: number;
  odds_size_ceil_usd: number;
  community_share: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_shrink_k: 8,
  peer_multiple_min: 0.05,
  peer_multiple_max: 1.25,
  odds_base: 0.3,
  odds_age_weight: 0.4,
  odds_size_weight: 0.3,
  odds_size_floor_usd: 5_000_000,
  odds_size_ceil_usd: 5_000_000_000,
  community_share: 0.07,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One launched peer: the category, market cap and TVL the peer table is built from. */
export type PeerTriple = [string, number, number];

/** One category's peer evidence: how many launched peers, their median multiple, the shrunk one used. */
export interface PeerEntry {
  peers: number;
  median: number;
  multiple: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  expected_value_usd: number;
  launch_odds: number;
  airdrop_estimate_usd: number;
  farm_capital_usd: number;
  hold_days: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page regenerates the farm plan from the same inputs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  expected_value_usd: number;
  launch_odds: number;
  airdrop_estimate_usd: number;
  farm_capital_usd: number;
  hold_days: number;
  peer_multiple: number;
  peer_count: number;
  peer_median: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peers, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_peer_median: number;
  peer_table: Record<string, PeerEntry>;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerTriple[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers; NaN when empty. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The launched peers: every protocol whose token trades, with a market cap and TVL to price from. */
export function launchedPeers(protocols: SnapshotProtocol[]): PeerTriple[] {
  return protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p): PeerTriple => [p.category ?? 'Other', p.mcap_usd!, p.tvl_usd])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]);
}

/** The peer table: each category's launched peers, their median multiple, and the shrunk one used. */
export function peerTable(peers: PeerTriple[], model: ModelConstants): { table: Record<string, PeerEntry>; globalMedian: number } {
  const ratios = peers.map(([, mcap, tvl]) => mcap / tvl);
  const globalMedian = median(ratios);
  const byCategory = new Map<string, number[]>();
  for (const [category, mcap, tvl] of peers) {
    const list = byCategory.get(category) ?? [];
    list.push(mcap / tvl);
    byCategory.set(category, list);
  }
  const table: Record<string, PeerEntry> = {};
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const med = median(list);
    const shrunk = (list.length * med + model.peer_shrink_k * globalMedian) / (list.length + model.peer_shrink_k);
    table[category] = {
      peers: list.length,
      median: round4(med),
      multiple: round4(Math.min(model.peer_multiple_max, Math.max(model.peer_multiple_min, shrunk))),
    };
  }
  return { table, globalMedian: round4(globalMedian) };
}

/** The peer multiple one protocol gets: its category's shrunk multiple, else the global median. */
export function peerMultipleFor(category: string | null, table: Record<string, PeerEntry>, globalMedian: number, model: ModelConstants): { multiple: number; count: number; median: number } {
  const key = category ?? 'Other';
  const entry = table[key];
  if (entry === undefined) {
    const g = Math.min(model.peer_multiple_max, Math.max(model.peer_multiple_min, globalMedian));
    return { multiple: g, count: 0, median: round4(globalMedian) };
  }
  return { multiple: entry.multiple, count: entry.peers, median: entry.median };
}

/** The launch odds one protocol gets, from its age and size: 0.30 to 1.00. */
export function launchOdds(age: number | null, tvlUsd: number, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  const ageF = Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days;
  const sizeF = Math.min(1, Math.max(0, (Math.log10(Math.max(tvlUsd, 1)) - Math.log10(model.odds_size_floor_usd)) / (Math.log10(model.odds_size_ceil_usd) - Math.log10(model.odds_size_floor_usd))));
  return round4(model.odds_base + model.odds_age_weight * ageF + model.odds_size_weight * sizeF);
}

/** The multipliers and values one protocol gets under `model` and the peer table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: Record<string, PeerEntry>,
  globalMedian: number,
  model: ModelConstants,
): { implied: number; expected: number; odds: number; peer: { multiple: number; count: number; median: number }; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerMultipleFor(protocol.category, table, globalMedian, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer.multiple * growthMult * maturityMult));
  const odds = launchOdds(age, protocol.tvl_usd, model);
  const expected = Math.max(1, Math.round(implied * odds));
  return { implied, expected, odds, peer, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are wrapped, staked or bridged products of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking in a name: a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a name: an exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades (the house's watchlist rule, applied to the whole board),
 * not an exchange, not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The protocols the board ranks, strongest first, with ranks 1..n: the watchlist, then every other rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = launchedPeers(snapshot.protocols);
  const { table, globalMedian } = peerTable(peers, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p) || watch.has(p.slug));
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  const index = bySlug(snapshot.protocols);
  const missing = snapshot.watchlist.filter((s) => !index.has(s));
  if (missing.length > 0) throw new SnapshotError(`snapshot.json's watchlist names ${missing.length} slug(s) the protocols do not carry`);

  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, globalMedian, model);
    const capital = capitalFor(p.tvl_usd);
    const hold = holdDaysFor(v.age);
    const airdrop = Math.round(v.implied * model.community_share * (capital / Math.max(p.tvl_usd, 1)) * v.odds * 100) / 100;
    return { p, ...v, capital, hold, airdrop };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    expected_value_usd: s.expected,
    launch_odds: s.odds,
    airdrop_estimate_usd: s.airdrop,
    farm_capital_usd: s.capital,
    hold_days: s.hold,
    model: {
      peer_multiple: s.peer.multiple,
      peer_count: s.peer.count,
      peer_median: s.peer.median,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, s.capital, s.airdrop).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in whole dollars, from the chain's own fees. */
export function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'tron') return 2;
  if (c === 'bitcoin') return 3;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'polygon' || c === 'stellar' || c === 'flare' || c === 'ripple' || c === 'near' || c === 'sei') return 0;
  if (c === 'avalanche') return 1;
  return 1;
}

/** The gas line for a chain: cheap chains read as under a dollar, dear ones name the price. */
export function gasLine(chain: string): string {
  const g = gasFor(chain);
  if (g === 0) return 'under $1 of gas';
  return `about $${g} of gas`;
}

/** A compact dollar figure: $306M, $1.2B, $950K, $42. */
export function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

/** The category's action, in the words a farmer can follow: [keyword, template] in first-match order. */
const ACTIONS: Array<[string, string]> = [
  ['lend', 'Supply ${C} of USDC to ${N} on ${H} and keep the position open'],
  ['cdp', 'Open a collateral position with ${C} of USDC on ${N} and keep it open'],
  ['collateral', 'Post ${C} of collateral on ${N} and keep the position open'],
  ['dex', 'Provide ${C} of liquidity to ${N}\u2019s main pool on ${H} and keep the position open'],
  ['yield', 'Deposit ${C} into ${N}\u2019s main yield strategy on ${H} and keep the shares'],
  ['leveraged farm', 'Open a ${C} leveraged farming position on ${N} and keep it open'],
  ['farm', 'Deposit ${C} into ${N}\u2019s farm on ${H} and keep the position open'],
  ['bridge', 'Bridge ${C} of USDC to ${H} through ${N} and use the bridged funds in its app'],
  ['restak', 'Restake ${C} of the receipt token through ${N} and keep the position'],
  ['staking', 'Stake ${C} of the chain\u2019s staking asset through ${N} and keep the receipt'],
  ['perpetual', 'Deposit ${C} of USDC as margin on ${N} and open one small hedge'],
  ['derivative', 'Deposit ${C} of USDC as margin on ${N} and open one small position'],
  ['prediction', 'Fund ${C} and place one market position on ${N}'],
  ['curator', 'Deposit ${C} into a ${N} vault on ${H} and keep the shares'],
  ['allocator', 'Deposit ${C} into a ${N} vault on ${H} and keep the shares'],
  ['stable', 'Mint or deposit ${C} of the stable asset through ${N} on ${H}'],
  ['rwa', 'Mint ${C} of the protocol\u2019s yield asset on ${H} and hold it'],
  ['insurance', 'Buy ${C} of cover from ${N} on ${H} and keep the policy'],
  ['basis', 'Deposit ${C} into ${N}\u2019s basis vault on ${H} and keep the shares'],
  ['chain', 'Bridge ${C} to the chain and use ${N}\u2019s flagship app once a week'],
  ['liquidity manager', 'Deposit ${C} into a ${N} managed pool on ${H} and keep the shares'],
  ['anchor btc', 'Deposit ${C} of BTC through ${N} and hold the receipt'],
  ['bitcoin', 'Deposit ${C} of BTC through ${N} and hold the receipt'],
  ['cedefi', 'Deposit ${C} into ${N}\u2019s vault on ${H} and keep the shares'],
  ['otc', 'Fund ${C} and place one order on ${N}\u2019s desk'],
  ['payment', 'Fund ${C} and make one payment through ${N}'],
  ['governance', 'Deposit ${C} and vote once through ${N}'],
  ['card', 'Order the ${N} card, fund it with ${C} and spend once'],
  ['index', 'Buy ${C} of the ${N} index on ${H} and hold it'],
  ['rate', 'Open a ${C} interest-rate position on ${N} and hold it'],
];

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const [keyword, template] of ACTIONS) {
    if (c.includes(keyword)) {
      return `${template.replaceAll('${C}', `$${capital}`).replaceAll('${N}', p.name).replaceAll('${H}', chain)}.`;
    }
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, implied value), never from a hand-written
 * list of names. The dashboard's page generates the same six steps from the same inputs.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, capital: number, airdrop: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasLine(chain);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `At this board\u2019s implied value of ${compactUsd(implied)} and a 7% community allocation, a $${capital} position\u2019s pro-rata share would be about ${compactUsd(airdrop)} if a token launches; points programs often pay more than pro-rata, so open the protocol\u2019s own points page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    expected_value_usd: row.expected_value_usd,
    launch_odds: row.launch_odds,
    airdrop_estimate_usd: row.airdrop_estimate_usd,
    farm_capital_usd: row.farm_capital_usd,
    hold_days: row.hold_days,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    peer_median: row.model.peer_median,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = launchedPeers(snapshot.protocols);
  const { table, globalMedian } = peerTable(peers, model);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_peer_median: globalMedian,
    peer_table: table,
    rows: board.map(radarRow),
    live,
    peers,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
