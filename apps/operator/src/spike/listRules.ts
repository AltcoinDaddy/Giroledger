/**
 * Every rule this account owns, in one view.
 *
 *   pnpm --filter @giroledger/operator rules
 *
 * Written after a keeper batch reported `count: 2` when only one rule was
 * known. A product whose pitch is "you can always see exactly what it is
 * allowed to do" cannot have rules nobody can enumerate.
 *
 * Reads `rulesOf(account)`, which is the same list the web page shows, so the
 * two cannot disagree.
 */
import { createPublicClient, formatUnits, http, type Address } from "viem";
import {
  coston2,
  deriveStatus,
  erc20Abi,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  type Rule,
  type TriggerValue,
} from "@giroledger/shared";

const req = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} not set`);
  return v;
};

async function main(): Promise<void> {
  const client = createPublicClient({
    chain: coston2,
    transport: http(process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!),
  });

  const registry = req("RULE_REGISTRY_ADDRESS") as Address;
  const executor = req("RULE_EXECUTOR_ADDRESS") as Address;
  const fxrp = req("FXRP_ADDRESS") as Address;
  const mac = req("MASTER_ACCOUNT_CONTROLLER") as Address;

  // Either give the account directly, or let it be derived from the XRPL side,
  // which is the path the product actually uses.
  let account = process.env["PERSONAL_ACCOUNT"] as Address | undefined;
  if (!account) {
    const xrplAddress = req("XRPL_ADDRESS_TO_INSPECT");
    account = (await client.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getPersonalAccount",
      args: [xrplAddress],
    })) as Address;
  }

  const ids = await client.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "rulesOf",
    args: [account],
  });

  const [dec, balance, allowance] = await Promise.all([
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    client.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, executor],
    }),
  ]);
  const f = (v: bigint): string => formatUnits(v, dec);
  const now = BigInt(Math.floor(Date.now() / 1000));

  console.log(`\nAccount ${account}`);
  console.log(`  FXRP balance          ${f(balance)}`);
  console.log(`  TOTAL live allowance  ${f(allowance)}  <- the real ceiling on everything below`);
  console.log(`  registry ${registry}`);
  console.log(`\n  ${ids.length} rule(s)\n`);

  let liveCommitment = 0n;

  for (const ruleId of ids) {
    const r = await client.readContract({
      address: registry,
      abi: ruleRegistryAbi,
      functionName: "getRule",
      args: [ruleId],
    });

    const rule: Rule = {
      ruleId,
      account: r.account,
      vault: r.vault,
      amountPerRun: r.amountPerRun,
      totalSpendCap: r.totalSpendCap,
      totalSpent: r.totalSpent,
      nextRunAt: r.nextRunAt,
      intervalSecs: r.intervalSecs,
      maxRuns: r.maxRuns,
      runsDone: r.runsDone,
      thresholdPrice: r.thresholdPrice,
      trigger: r.trigger as TriggerValue,
      active: r.active,
    };
    const status = deriveStatus(rule, now);
    if (r.active) liveCommitment += r.totalSpendCap - r.totalSpent;

    console.log(`  ${ruleId}`);
    console.log(
      `      ${status.toUpperCase().padEnd(10)} ${r.runsDone}/${r.maxRuns === 0 ? "∞" : r.maxRuns} runs` +
        `  ·  ${f(r.totalSpent)}/${f(r.totalSpendCap)} FXRP` +
        `  ·  every ${r.intervalSecs}s`,
    );
    console.log(`      vault ${r.vault}`);
    if (r.active) {
      console.log(
        `      next run ${new Date(Number(r.nextRunAt) * 1000).toISOString()}` +
          `  ·  can still spend ${f(r.totalSpendCap - r.totalSpent)} FXRP`,
      );
    }
    console.log();
  }

  console.log(`  Unspent commitment across active rules: ${f(liveCommitment)} FXRP`);
  if (allowance < liveCommitment) {
    console.log("  The allowance is BELOW that, so the allowance binds first. Safe.");
  } else if (allowance > liveCommitment) {
    console.log(
      `  WARNING: allowance (${f(allowance)}) exceeds what active rules can spend ` +
        `(${f(liveCommitment)}). Residual approval from a cancelled rule.`,
    );
  }
  console.log();
}

main().catch((e: unknown) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
