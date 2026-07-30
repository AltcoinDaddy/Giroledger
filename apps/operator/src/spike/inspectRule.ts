/**
 * What does the chain actually think about our rule?
 *
 *   RULE_ID=0xbae7... pnpm --filter @giroledger/operator inspect-rule
 *
 * Written because the keeper reported sixty successful batches while the rule
 * never advanced. `executeBatch` catches individual failures on purpose, so a
 * batch can "succeed" having executed nothing. This reads the truth.
 */
import { createPublicClient, formatUnits, http, type Address, type Hex } from "viem";
import { coston2, erc20Abi, erc4626Abi, ruleRegistryAbi } from "@giroledger/shared";

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
  const ruleId = req("RULE_ID") as Hex;

  const r = await client.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "getRule",
    args: [ruleId],
  });

  const dec = await client.readContract({ address: fxrp, abi: erc20Abi, functionName: "decimals" });
  const f = (v: bigint): string => formatUnits(v, dec);

  console.log(`\nRule ${ruleId}`);
  console.log(`  account        ${r.account}`);
  console.log(`  vault          ${r.vault}`);
  console.log(`  active         ${r.active}`);
  console.log(`  runsDone       ${r.runsDone} / ${r.maxRuns === 0 ? "unlimited" : r.maxRuns}`);
  console.log(`  spent          ${f(r.totalSpent)} of ${f(r.totalSpendCap)}`);
  console.log(`  nextRunAt      ${new Date(Number(r.nextRunAt) * 1000).toISOString()}`);

  const due = await client.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "isDue",
    args: [ruleId],
  });
  console.log(`  isDue          ${due}`);

  const [accountFxrp, allowance, execFxrp, shares] = await Promise.all([
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "balanceOf", args: [r.account] }),
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "allowance", args: [r.account, executor] }),
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "balanceOf", args: [executor] }),
    client.readContract({ address: r.vault, abi: erc4626Abi, functionName: "balanceOf", args: [r.account] }),
  ]);

  console.log(`\n  account FXRP   ${f(accountFxrp)}`);
  console.log(`  allowance      ${f(allowance)}   (executor may pull this much)`);
  console.log(`  executor FXRP  ${f(execFxrp)}   (should be 0)`);
  console.log(`  vault shares   ${shares}   (owned by the user)`);

  console.log("\n  --- diagnosis ---");
  if (r.runsDone === 0 && due) {
    console.log("  The rule has NEVER executed but reports as due.");
    console.log("  Every keeper batch was catching a revert and reporting success.");
    if (allowance === 0n) console.log("  CAUSE: allowance is zero. The approve call did not land.");
    else if (accountFxrp < r.amountPerRun) console.log("  CAUSE: account has less FXRP than one run needs.");
    else console.log("  CAUSE: not balance or allowance. Simulate execute() to see the revert.");
  } else if (r.runsDone > 0) {
    console.log(`  Executed ${r.runsDone} time(s). Working as intended.`);
  }
  console.log();
}

main().catch((e: unknown) => {
  console.error("failed:", e);
  process.exit(1);
});
