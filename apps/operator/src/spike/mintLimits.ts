/**
 * SPIKE S-10 / Q7: can we actually direct-mint FXRP right now, and how much
 * before something delays us?
 *
 *   pnpm --filter operator spike:limits            # default 10 XRP pre-flight
 *   MINT_PREFLIGHT_XRP=100 pnpm --filter operator spike:limits
 *
 * This matters more than it looks. Custom instructions ride on a direct mint
 * (spec.md §4.1), so rule creation inherits every minting rate limit. A demo
 * that stalls for two hours because the mint was silently deferred is a demo
 * that does not exist.
 *
 * The good news, from the docs: all three mechanisms THROTTLE rather than
 * reject. An over-limit mint emits `DirectMintingDelayed` with an
 * `executionAllowedAt` timestamp; the executor retries with the same FDC proof
 * afterwards. So the failure mode is latency, not rejection.
 *
 * Logic mirrors:
 *   https://dev.flare.network/fassets/developer-guides/fassets-mint-limits
 */
import { createPublicClient, http, type Address } from "viem";
import {
  coston2,
  FLARE_CONTRACT_REGISTRY,
  flareContractRegistryAbi,
  explorerAddress,
} from "@giroledger/shared";

const HOURLY_WINDOW = 3600n;
const DAILY_WINDOW = 86400n;
const DROPS_PER_XRP = 1_000_000n;

const rpc = process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!;
const client = createPublicClient({ chain: coston2, transport: http(rpc) });

/**
 * Read-only slice of IAssetManager.
 *
 * Names are taken from the mint-limits guide. Integer widths are declared as
 * uint256 deliberately: the on-chain types are narrower in places (the limiter
 * stores minted volume as uint64), but ABI words are 32 bytes either way, so a
 * widened read decodes correctly and cannot silently truncate.
 */
const assetManagerAbi = [
  { type: "function", name: "assetMintingGranularityUBA", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getDirectMintingHourlyLimitUBA", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getDirectMintingDailyLimitUBA", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getDirectMintingHourlyLimiterState", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "getDirectMintingDailyLimiterState", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "getDirectMintingsUnblockUntilTimestamp", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getDirectMintingLargeMintingThresholdUBA", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getDirectMintingLargeMintingDelaySeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const xrp = (uba: bigint): string =>
  `${(Number(uba) / Number(DROPS_PER_XRP)).toLocaleString("en-US", { maximumFractionDigits: 6 })} XRP`;

const at = (ts: bigint, now: bigint): string => {
  const delta = Number(ts - now);
  const rel = delta <= 0 ? "now" : delta < 120 ? `in ${delta}s` : `in ${Math.round(delta / 60)} min`;
  return `${new Date(Number(ts) * 1000).toISOString()} (${rel})`;
};

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/**
 * Windows are clock-aligned and tumbling, not rolling, and reads are stale
 * between writes. Replay the slide off-chain or the numbers you print are
 * whatever they were at the last write, which can be hours ago.
 */
function windowState(args: {
  now: bigint;
  windowStart: bigint;
  usedUBA: bigint;
  limitUBA: bigint;
  size: bigint;
}): { start: bigint; used: bigint; remaining: bigint; resetsAt: bigint } {
  let start = args.windowStart;
  let used = args.usedUBA;

  if (start > 0n && args.now >= start + args.size) {
    const elapsed = (args.now - start) / args.size;
    start += elapsed * args.size;
    const drained = elapsed * args.limitUBA;
    used = drained >= used ? 0n : used - drained;
  }

  return {
    start,
    used,
    remaining: args.limitUBA > used ? args.limitUBA - used : 0n,
    resetsAt: start + args.size,
  };
}

/** Overflow drains proportionally through the current window. */
function windowAllowedAt(args: {
  now: bigint;
  start: bigint;
  used: bigint;
  proposed: bigint;
  limit: bigint;
  size: bigint;
  disabled: boolean;
}): bigint {
  if (args.disabled || args.limit === 0n || args.proposed === 0n) return args.now;
  const after = args.used + args.proposed;
  if (after <= args.limit) return args.now;
  return args.start + (args.size * after) / args.limit;
}

async function main(): Promise<void> {
  const preflightXrp = Number(process.env["MINT_PREFLIGHT_XRP"] ?? 10);
  const proposed = BigInt(Math.round(preflightXrp * Number(DROPS_PER_XRP)));

  const assetManager = (await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: ["AssetManagerFXRP"],
  })) as Address;

  console.log(`\nAssetManagerFXRP: ${assetManager}`);
  console.log(`  ${explorerAddress(assetManager)}\n`);

  const read = <T extends (typeof assetManagerAbi)[number]["name"]>(name: T) =>
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: name });

  const [granularity, hourlyLimit, dailyLimit, hourlyState, dailyState, unblockUntil, largeThreshold, largeDelay] =
    await Promise.all([
      read("assetMintingGranularityUBA"),
      read("getDirectMintingHourlyLimitUBA"),
      read("getDirectMintingDailyLimitUBA"),
      read("getDirectMintingHourlyLimiterState"),
      read("getDirectMintingDailyLimiterState"),
      read("getDirectMintingsUnblockUntilTimestamp"),
      read("getDirectMintingLargeMintingThresholdUBA"),
      read("getDirectMintingLargeMintingDelaySeconds"),
    ]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const disabled = (unblockUntil as bigint) > now;

  // Limiter state stores minted volume in AMG, not UBA. Rebase before comparing.
  const [hStart, hMintedAmg] = hourlyState as readonly [bigint, bigint];
  const [dStart, dMintedAmg] = dailyState as readonly [bigint, bigint];

  const hourly = windowState({
    now,
    windowStart: hStart,
    usedUBA: hMintedAmg * (granularity as bigint),
    limitUBA: hourlyLimit as bigint,
    size: HOURLY_WINDOW,
  });
  const daily = windowState({
    now,
    windowStart: dStart,
    usedUBA: dMintedAmg * (granularity as bigint),
    limitUBA: dailyLimit as bigint,
    size: DAILY_WINDOW,
  });

  const show = (label: string, limit: bigint, w: ReturnType<typeof windowState>): void => {
    const pct = limit === 0n ? 0 : Number((w.used * 10000n) / limit) / 100;
    console.log(`=== ${label} ===`);
    console.log(`  limit      ${xrp(limit)}`);
    console.log(`  used       ${xrp(w.used)} (${pct.toFixed(2)}%)`);
    console.log(`  remaining  ${xrp(w.remaining)}`);
    console.log(`  resets     ${at(w.resetsAt, now)}\n`);
  };

  show("Hourly window", hourlyLimit as bigint, hourly);
  show("Daily window", dailyLimit as bigint, daily);

  console.log("=== Large mint rule ===");
  console.log(`  threshold  ${xrp(largeThreshold as bigint)}`);
  console.log(`  delay      ${(largeDelay as bigint).toString()}s`);
  console.log(`  limiter    ${disabled ? `DISABLED until ${at(unblockUntil as bigint, now)}` : "active"}\n`);

  const headroom = min(
    min(disabled ? (hourlyLimit as bigint) : hourly.remaining, disabled ? (dailyLimit as bigint) : daily.remaining),
    largeThreshold as bigint,
  );
  console.log(`Largest mint with NO delay right now: ${xrp(headroom)}\n`);

  // --- pre-flight ---------------------------------------------------------
  const hourlyAt = windowAllowedAt({ now, start: hourly.start, used: hourly.used, proposed, limit: hourlyLimit as bigint, size: HOURLY_WINDOW, disabled });
  const dailyAt = windowAllowedAt({ now, start: daily.start, used: daily.used, proposed, limit: dailyLimit as bigint, size: DAILY_WINDOW, disabled });
  const largeAt = proposed > (largeThreshold as bigint) ? now + (largeDelay as bigint) : now;
  const allowedAt = max(hourlyAt, max(dailyAt, largeAt));

  console.log(`=== Pre-flight: ${preflightXrp} XRP ===`);
  if (allowedAt <= now) {
    console.log("  Executes immediately. No rate-limit delay.");
    console.log("  Q7 answered: rule creation at this size is safe for the demo.\n");
    return;
  }

  const reasons = [
    hourlyAt === allowedAt ? "hourly window" : null,
    dailyAt === allowedAt ? "daily window" : null,
    largeAt === allowedAt ? "large-mint threshold" : null,
  ].filter(Boolean);

  console.log(`  DELAYED until ${at(allowedAt, now)}`);
  console.log(`  Binding rule: ${reasons.join(", ")}`);
  console.log("  The mint is not rejected. The executor retries with the same FDC");
  console.log("  proof after that timestamp, so this is latency, not failure.");
  console.log(`  For the demo, mint at or below ${xrp(headroom)} to avoid it.\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nspike failed:", error);
  process.exit(1);
});
