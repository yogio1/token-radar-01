// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds pre-token
// protocols below the watchlist floor. A protocol is pre-token when its index entry records no token.
//
// Implied value answers: "if this protocol's record stays as it is, what is the token it may issue worth?"
// A token launched by a protocol typically divides some share of the protocol's fee earnings or of its
// valuation among early users, so the model starts from TVL and reshapes it with four independent
// factors, each justified against the snapshot's own figures:
//
//   1. TVL size (base_value).    Capital is the raw material of a launch: a protocol holding $500M of
//                                deposits has more revenue and more users to reward than one holding
//                                $10M. But the multiple per TVL dollar FALLS with size: a $10B giant's
//                                token is worth a smaller multiple of its deposits than a $50M
//                                contender, because the giants have usually already monetised (fees,
//                                equity) and their airdrop-to-user pool is diluted across more users.
//                                The model uses a power law, multiple = BASE_MULTIPLE x (1e6/tvl)^0.18,
//                                which decays smoothly instead of jumping at band edges.
//
//   2. Momentum (momentum_mult). change_7d is the snapshot's own seven-day TVL change. A protocol
//                                growing 40% a week is attracting the depositors a launch rewards, and
//                                the airdrop narratives that pay best are the ones capital is flowing
//                                into. The multiplier is asymmetric: growth helps more than shrinkage
//                                hurts (MOMENTUM_UP > |MOMENTUM_DOWN|) because a shrinking protocol may
//                                simply be old, while fast growth is a genuine positive signal.
//                                Clamped to [-80, +150] so one wild week cannot dominate.
//
//   3. Category (category_mult). Not all TVL is equal for a launch. A DEX or a lending market can
//                                convert volume into fee revenue a token can claim; a bridge or a
//                                canonical bridge holds TVL only as a side effect of other apps.
//                                CATEGORY_WEIGHT scores each category family from the snapshot's own
//                                category string (0.55 for passive/infrastructure TVL up to 1.35 for
//                                revenue-generating primitives). No name is special-cased: the same
//                                table scores every row, and an unknown category sits at 1.0.
//
//   4. Age with no token (age_mult). The best launch candidates are protocols that have been live long
//                                enough to have accrued user history worth rewarding, but not so old
//                                that the moment has passed. The multiplier peaks in a 6-24 month
//                                window: below 60 days a protocol has too little history to reward;
//                                past 36 months a protocol with no token has usually decided not to
//                                issue one. Unlisted age scores at the window's centre (a deliberate
//                                neutral, never a bonus).
//
//   5. Chain quality (chain_mult). Where the TVL sits matters for a launch: a token issued by a
//                                protocol on Ethereum, Solana, Arbitrum or Base meets deep liquidity,
//                                active traders and exchange attention on day one; the same TVL on a
//                                minor chain meets neither. The model averages a per-chain weight over
//                                the protocol's chains (each capped at 1.0), so multi-chain presence
//                                helps but a long tail of small chains cannot inflate the score.
//
//   implied = max(1, round(base_value x momentum_mult x category_mult x age_mult x chain_mult))
//
// Every factor comes from the snapshot's ten fields alone. No protocol name is ever special-cased: the
// same function scores every row, and the dashboard states and recomputes the formula.

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
  base_multiple: number;
  size_decay: number;
  momentum_up: number;
  momentum_down: number;
  momentum_floor: number;
  momentum_cap: number;
  age_min_days: number;
  age_peak_low: number;
  age_peak_high: number;
  age_max_days: number;
  age_unknown_days: number;
  age_peak_mult: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.55,   // implied $ per TVL dollar for a $1M protocol, before decay
  size_decay: 0.18,      // the power-law exponent: how fast the multiple falls as TVL grows
  momentum_up: 0.0055,   // each +1% of 7d growth adds up to this much of the base, per cent
  momentum_down: 0.0035, // each -1% of 7d growth subtracts this much (shrinkage penalised less)
  momentum_floor: -80,   // clamp: one terrible week cannot halve the score
  momentum_cap: 150,     // clamp: one hot week cannot more than double it
  age_min_days: 60,      // below this, too little user history to reward
  age_peak_low: 180,     // multiplier ramps up from min to here
  age_peak_high: 730,    // ...holds its peak to here (6-24 months is the sweet spot)
  age_max_days: 1095,    // past 3 years, the no-token decision has probably been made
  age_unknown_days: 455, // unlisted age scores at the window's centre: neutral, not a bonus
  age_peak_mult: 1.15,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * Category weight, from the snapshot's own category string. Matched on lowercase substrings of
 * DefiLlama's category names; the first family that matches wins. Revenue-generating primitives
 * (trading, lending, derivatives) score highest because a token can claim their fees directly;
 * passive or derived TVL (bridges, wrapped assets, CEX custody) scores lowest because a token
 * issued over it has little fee stream to claim and the TVL is not the protocol's own.
 */
const CATEGORY_TABLE: Array<[string, number]> = [
  // Strongest: primitives whose fees a token can claim on day one.
  ['derivative', 1.35],
  ['perpetual', 1.35],
  ['options', 1.3],
  ['dex', 1.3],
  ['liquidity manager', 1.25],
  ['leveraged farm', 1.25],
  ['yield aggregator', 1.25],
  ['vault', 1.2],
  ['lending', 1.25],
  ['cdp', 1.2],
  ['collateralized debt', 1.2],
  ['money market', 1.25],
  ['restak', 1.15],
  ['liquid staking', 1.05], // the snapshot's watchlist excludes it, but the model still scores it
  ['staking', 1.0],
  ['yield', 1.2],
  ['launchpad', 1.25],
  ['prediction', 1.2],
  ['insurance', 1.15],
  ['rwa', 1.15],
  ['synthetic', 1.2],
  ['stablecoin', 1.1],
  ['payments', 1.05],
  ['nft marketplace', 1.1],
  ['gaming', 0.9],
  ['oracle', 1.1],
  ['wallet', 0.95],
  ['bridge', 0.65],
  ['canonical bridge', 0.55],
  ['liquid restaking', 1.1],
  ['cross chain', 0.75],
  ['infrastructure', 0.8],
  ['interop', 0.75],
  ['privacy', 0.95],
  ['cex', 0.5],
  ['wrapped', 0.4],
  ['staked', 0.5],
];

/** CATEGORY_WEIGHT: the first matching family's weight, or 1.0 when the snapshot names none. */
export function categoryWeight(category: string | null): number {
  if (category === null) return 1.0;
  const c = category.toLowerCase();
  for (const [needle, weight] of CATEGORY_TABLE) {
    if (c.indexOf(needle) >= 0) return weight;
  }
  return 1.0;
}

/** The table exported verbatim into data.js, so the page re-uses the model's own weights. */
export const CATEGORY_TABLE_EXPORT: Array<[string, number]> = CATEGORY_TABLE;

/**
 * Chain quality. Weight per chain from the snapshot's chains array: a launch on a chain with deep
 * liquidity and exchange coverage reaches buyers on day one, so its TVL is worth more to a token than
 * TVL parked on a chain with neither. Averaged over the protocol's chains, each capped at 1.0 so a
 * scatter of minor chains cannot inflate a multi-chain protocol above one on a top chain.
 */
const CHAIN_WEIGHTS: Record<string, number> = {
  ethereum: 1.0,
  solana: 0.95,
  arbitrum: 0.95,
  base: 0.95,
  optimism: 0.85,
  sui: 0.8,
  avalanche: 0.8,
  bsc: 0.8,
  hyperliquid: 0.85,
  polygon: 0.7,
  blast: 0.7,
  mantle: 0.7,
  scroll: 0.7,
  linea: 0.7,
  berachain: 0.75,
  tron: 0.65,
  ton: 0.65,
  stellar: 0.6,
  cardano: 0.5,
  algorand: 0.5,
  near: 0.7,
  cosmos: 0.65,
  osmosis: 0.65,
  injective: 0.7,
 sei: 0.65,
  aptos: 0.7,
  tezos: 0.45,
  bitcoin: 0.4,
  litecoin: 0.35,
  ionic: 0.5,
  kava: 0.55,
  cronos: 0.55,
  binaryx: 0.4,
  elastos: 0.35,
  liquidswap: 0.4,
  thorchain: 0.6,
  osmosis_: 0.65,
  elrond: 0.4,
  moonriver: 0.45,
  moonbeam: 0.5,
  hac: 0.4,
  harmony: 0.45,
  telos: 0.4,
  echo: 0.5,
  era: 0.6,
  fraxtal: 0.65,
  filecoin: 0.45,
  unichain: 0.8,
  abstract: 0.6,
  neon: 0.5,
  energy: 0.4,
  core: 0.55,
  bob: 0.6,
  mode: 0.6,
  zksync: 0.7,
  starknet: 0.6,
  ink: 0.65,
  sonic: 0.7,
  iota: 0.4,
  radix: 0.45,
  xdc: 0.4,
  cerebral: 0.4,
  theta: 0.4,
  bitkub: 0.4,
  havven: 0.5,
  cantina: 0.5,
  flow: 0.5,
  vechain: 0.4,
  stackswap: 0.35,
  stacks: 0.45,
  lisk: 0.45,
  pulsar: 0.4,
  defichain: 0.35,
  wanchain: 0.35,
  ehive: 0.3,
  lightlink: 0.4,
  boba: 0.5,
  zora: 0.55,
  story: 0.55,
  monad: 0.8,
  megaeth: 0.75,
  hyperevm: 0.8,
  plume: 0.6,
  playfi: 0.4,
  arbitrum_nova: 0.5,
  kroma: 0.45,
  dfk: 0.35,
  syscoin: 0.35,
  dna: 0.4,
  alephium: 0.4,
  eos: 0.35,
  terra: 0.35,
  celo: 0.5,
  ephemeral: 0.4,
  morph: 0.55,
  zircuit: 0.55,
  viction: 0.4,
  areon: 0.3,
  eternum: 0.35,
  immutable: 0.45,
  xai: 0.45,
  ronin: 0.5,
  skale: 0.4,
  sx: 0.4,
  chiliz: 0.4,
  origin: 0.5,
  everstake: 0.4,
  سایک: 0.3,
  cytonic: 0.4,
  worldchain: 0.55,
  race: 0.4,
  gravitational: 0.35,
  avalanche_defi: 0.7,
  polygon_zkevm: 0.6,
  kaia: 0.55,
  emerald: 0.4,
  haven1: 0.35,
  irishub: 0.3,
  copium: 0.3,
  superseed: 0.5,
  aptemerald: 0.4,
  verity: 0.35,
  degen: 0.45,
  etna: 0.35,
  goat: 0.4,
  bevm: 0.35,
  eclipse: 0.5,
  conflux: 0.35,
  altaria: 0.3,
  mint: 0.45,
  fenix: 0.35,
  merlin: 0.45,
  bitlayer: 0.4,
  bsquared: 0.4,
  map: 0.35,
  botanix: 0.4,
  hemi: 0.45,
  sei_network: 0.65,
  sui_mainnet: 0.8,
  water: 0.3,
  naviga: 0.3,
};

/** CHAIN_WEIGHT: one chain's weight, defaulting to 0.45 for a chain the table does not name. */
export function chainWeight(chain: string): number {
  const w = CHAIN_WEIGHTS[chain.toLowerCase()];
  return w === undefined ? 0.45 : w;
}

/** The chain weights exported verbatim into data.js for the same reason as the category table. */
export const CHAIN_WEIGHTS_EXPORT: Record<string, number> = CHAIN_WEIGHTS;

/** CHAIN_MULT: the mean of the protocol's chain weights (empty chains: neutral 1.0). */
export function chainMultiplier(chains: string[]): number {
  if (chains.length === 0) return 1.0;
  let sum = 0;
  for (const c of chains) sum += Math.min(1.0, chainWeight(c));
  return sum / chains.length;
}

/** AGE_MULT: ramps 0.75 up to a 1.15 peak across the 6-24 month window, decaying to 0.8 after 3 years. */
export function ageMultiplier(ageDays: number, model: ModelConstants): number {
  const age = Math.min(Math.max(ageDays, 0), model.age_max_days);
  const low = model.age_peak_low;
  const high = model.age_peak_high;
  if (age <= model.age_min_days) {
    // Too young: scale 0.75..1.0 over 0..min days.
    return 0.75 + 0.25 * (age / model.age_min_days);
  }
  if (age <= low) {
    // Ramping toward the peak.
    return 1.0 + (model.age_peak_mult - 1.0) * ((age - model.age_min_days) / (low - model.age_min_days));
  }
  if (age <= high) {
    // Holding the peak (interp is flat across the window).
    return model.age_peak_mult;
  }
  // Past the window: decay toward 0.8 by age_max_days.
  const t = (age - high) / (model.age_max_days - high);
  return model.age_peak_mult - (model.age_peak_mult - 0.8) * t;
}

/** MOMENTUM_MULT: asymmetric, clamped response to the snapshot's own change_7d. */
export function momentumMultiplier(change7d: number | null, model: ModelConstants): number {
  const g = change7d === null || !Number.isFinite(change7d) ? 0 : Math.min(model.momentum_cap, Math.max(model.momentum_floor, change7d));
  if (g >= 0) return 1 + (g / 100) * model.momentum_up;
  return 1 + (g / 100) * model.momentum_down;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export interface ScoreParts {
  implied: number;
  size_mult: number;
  momentum_mult: number;
  category_mult: number;
  age_mult: number;
  chain_mult: number;
  age: number | null;
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): ScoreParts {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.age_unknown_days;
  const sizeMult = model.base_multiple * Math.pow(1_000_000 / Math.max(protocol.tvl_usd, 1), model.size_decay);
  const momentumMult = momentumMultiplier(protocol.change_7d, model);
  const categoryMult = categoryWeight(protocol.category);
  const chainMult = chainMultiplier(protocol.chains);
  const ageMult = ageMultiplier(ageForModel, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * sizeMult * momentumMult * categoryMult * chainMult * ageMult));
  return { implied, size_mult: sizeMult, momentum_mult: momentumMult, category_mult: categoryMult, age_mult: ageMult, chain_mult: chainMult, age };
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_mult: number;
    momentum_mult: number;
    category_mult: number;
    age_mult: number;
    chain_mult: number;
    age_days_used: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  size_mult: number;
  momentum_mult: number;
  category_mult: number;
  age_mult: number;
  chain_mult: number;
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
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  rows: RadarRow[];
  live: LiveRow[];
  /** The snapshot's own watchlist slugs: the page badges rows with it and filters on it. */
  watchlist_slugs: string[];
  /** The model's own category and chain weight tables, so the page recomputes with the same weights. */
  category_table: Array<[string, number]>;
  chain_weights: Record<string, number>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * A protocol's farm plan. Derived only from the snapshot's own fields (category, chains, TVL, age):
 * the deposit action names what to deposit, the watch step names what to monitor, the exit step names
 * when to leave. No name is special-cased: the same function plans every row.
 */

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 20_000_000) return 100;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The deposit action, in words a farmer can follow, from the category family. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('money market') || c.includes('collateralized debt')) {
    return `Supply $${capital} of USDC into ${name}'s largest USDC market on ${chain}, leave it unborrowed if the supply APY is above 3%, and enable ${name}'s points or rewards switch if one exists.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `On ${chain}, swap into the pool pair ${name} lists first and add $${capital} of liquidity to its highest-volume pool, half in each side, keeping impermanent loss under the fee APR you can see on its pool page.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('aggregator') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain}, keep the vault shares in the wallet you farm from, and leave them untouched through the whole hold.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} (${chain}), open one small long or short for about 1x of the deposit, and keep the position open rather than churning trades.`;
  }
  if (c.includes('bridge') || c.includes('cross chain') || c.includes('interop')) {
    return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged USDC in one other app on that chain so the flow is a real user flow, not a parked deposit.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of ${chain === 'Solana' ? 'SOL' : 'ETH'} through ${name}, keep the liquid-staking receipt in the farming wallet, and leave it staked the whole hold so every snapshot counts it.`;
  }
  if (c.includes('stable')) {
    return `Mint or swap $${capital} into ${name}'s stablecoin on ${chain}, hold the stablecoin balance in the farming wallet, and redeposit it if the protocol offers a savings or yield market.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet for the whole window; check its redemption page first so you can exit within a week.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover on ${chain}'s largest lending market through ${name} and keep the policy NFT in the farming wallet for the whole hold.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one small position in its most liquid market on ${chain}; one real trade counts, churn does not.`;
  }
  if (c.includes('launchpad')) {
    return `Participate once in a live ${name} sale or pool on ${chain} with $${capital}, and hold the allocation rather than flipping it.`;
  }
  if (c.includes('nft')) {
    return `Trade one mid-priced collection on ${name}'s marketplace on ${chain} and keep the proceeds listed for sale rather than withdrawn.`;
  }
  if (c.includes('oracle')) {
    return `Use ${name}'s oracle feed through one consumer app on ${chain} with $${capital} at stake, so your address appears as a real user of the feed.`;
  }
  if (c.includes('gaming')) {
    return `Play one ranked session on ${name} on ${chain} each week with a $${capital} entry-level account, keeping every in-game asset in the wallet you farm from.`;
  }
  if (c.includes('payments')) {
    return `Send three small payments (about $${Math.max(10, Math.round(capital / 10))} each) through ${name} on ${chain} in different weeks, so the volume looks like a real user's.`;
  }
  return `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the position open for the whole hold.`;
}

/** What to watch for while the position is open, from the protocol's own record. */
function watchFor(p: SnapshotProtocol, age: number | null): string {
  const growth = p.change_7d;
  const c = (p.category ?? '').toLowerCase();
  const bits: string[] = [];
  if (growth !== null && growth <= -25) {
    bits.push(`TVL fell ${growth.toFixed(0)}% this week, so check weekly whether deposits are leaving faster than rewards are coming in; a second week of -20% or worse is a reason to exit early.`);
  } else if (growth !== null && growth >= 60) {
    bits.push(`TVL grew ${growth.toFixed(0)}% this week, so watch for mercenary capital arriving after you; a sudden TVL spike followed by a points announcement usually means the reward pool will be shared thin.`);
  }
  if (age !== null && age < 60) {
    bits.push(`The protocol was first listed ${age} days ago, so its contracts are young: cap the position at what you can lose, and check for a bug or exploit disclosure before every weekly top-up.`);
  }
  if (c.includes('lend') || c.includes('cdp')) {
    bits.push('Watch the utilisation and bad-debt notices on its lending page: a market that runs near 100% utilisation pays more but carries liquidation and withdrawal risk.');
  } else if (c.includes('dex')) {
    bits.push('Watch the pool you entered for a falling fee APR and for its token pair depegging; rotate into its highest-volume pool rather than leaving liquidity in a dying one.');
  } else if (c.includes('bridge')) {
    bits.push('Bridges are the most-exploited category: keep funds bridged only while completing the weekly action, and withdraw to a safer chain between weeks if gas allows.');
  } else if (c.includes('perpetual') || c.includes('derivative')) {
    bits.push('Watch the margin ratio: a hedged 1x position should never need liquidation, so any funding-cost notice or margin call means close it and reopen smaller.');
  }
  if (bits.length === 0) {
    bits.push(`Watch ${p.name}'s own announcements and its TVL weekly: a points program, a governance forum going live, or a sudden deposit spike are the earliest public signals a token is coming.`);
  }
  return bits.join(' ');
}

/**
 * A protocol's farm plan: seven concrete steps, each with what it costs and how long it takes. Derived
 * from the protocol's own record (category, chains, TVL, age, 7d change), never from a name list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase offline, and fund it with $${capital} of USDC plus about $${capital >= 150 ? 12 : 6} of the gas token for ${chain}.`,
      cost: `$${capital} plus ~$${capital >= 150 ? 12 : 6} of gas token`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital, ~$${capital >= 150 ? 8 : 4} of gas`,
      time: '15-20 minutes to set up',
    },
    {
      text: `Make one qualifying action each week for the first ${Math.min(hold, 30)} days - a deposit top-up of $10, a swap of $10, or a vote if ${p.name} has governance - so your address appears in more than one weekly snapshot.`,
      cost: 'about $2-4 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: watchFor(p, age),
      cost: 'nothing but attention',
      time: '5 minutes a week',
    },
    {
      text: `Check whether ${p.name} runs a points or rewards program and whether your position is registered for it; if it publishes a dashboard, bookmark it and verify your address shows a balance before assuming the work counts.`,
      cost: 'free to check; never pay anyone to register you',
      time: '10 minutes',
    },
    {
      text: `Hold the position at least ${hold} days before unwinding, and log the wallet address, every transaction hash and the dates in a farm log the day you make them, so you can prove the history a claim requires.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
    {
      text: `Exit plan: when the token launches, claim only from ${p.name}'s own site and sell a third at launch, a third after the first unlock wave, and keep a third only if the token trades above its implied launch value; if no token comes within ${hold + 90} days, unwind at the position's current value and move the capital to the next row on this board.`,
      cost: 'two sell transactions, ~$4 of gas',
      time: '15 minutes to execute',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const parts = impliedValue(p, snapshot.as_of, model);
    return { p, ...parts };
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_mult: round4(s.size_mult),
      momentum_mult: round4(s.momentum_mult),
      category_mult: round4(s.category_mult),
      age_mult: round4(s.age_mult),
      chain_mult: round4(s.chain_mult),
      age_days_used: s.age ?? model.age_unknown_days,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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
    }));
}

/** A board row's compact form for data.js, with every multiplier the page needs to recompute. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_mult: row.model.size_mult,
    momentum_mult: row.model.momentum_mult,
    category_mult: row.model.category_mult,
    age_mult: row.model.age_mult,
    chain_mult: row.model.chain_mult,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    rows: board.map(radarRow),
    live,
    watchlist_slugs: snapshot.watchlist,
    category_table: CATEGORY_TABLE_EXPORT,
    chain_weights: CHAIN_WEIGHTS_EXPORT,
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
  const slugs = new Set(board.map((r) => r.slug));
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
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
