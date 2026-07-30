/**
 * SPIKE S-05: resolve an XRPL address to its Flare PersonalAccount, and dump
 * everything the rest of the build depends on.
 *
 *   pnpm --filter @giroledger/operator spike:resolve rXXXXXXXXXXXXXXXXXXXXXXXXXX
 *
 * Every signature used here comes from:
 *   https://dev.flare.network/smart-accounts/guides/typescript-viem/state-lookup-ts
 *   https://dev.flare.network/smart-accounts/reference/IMasterAccountController
 *
 * This script answers spike questions Q1 and Q4, and prints the operator XRPL
 * address you will need for S-06. Run it before anything else.
 */
import { createPublicClient, http, type Address } from "viem";
import {
  coston2,
  FLARE_CONTRACT_REGISTRY,
  flareContractRegistryAbi,
  masterAccountControllerAbi,
  personalAccountAbi,
  erc20Abi,
  erc4626Abi,
  vaultTypeLabel,
  explorerAddress,
} from "@giroledger/shared";

const rpc = process.env.COSTON2_RPC_URL ?? coston2.rpcUrls.default.http[0]!;
const client = createPublicClient({ chain: coston2, transport: http(rpc) });

async function contractByName(name: string): Promise<Address> {
  return client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
}

async function main(): Promise<void> {
  const xrplAddress = process.argv[2];
  if (!xrplAddress) {
    console.error("usage: spike:resolve <xrpl-address>");
    process.exit(1);
  }

  console.log(`\nRPC: ${rpc}`);
  console.log(`XRPL address: ${xrplAddress}\n`);

  const mac = await contractByName("MasterAccountController");
  console.log(`MasterAccountController: ${mac}`);
  console.log(`  ${explorerAddress(mac)}\n`);

  // --- Q1: is there a public operator, or must we run our own? ------------
  const operators = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getXrplProviderWallets",
  });
  console.log("Registered operator XRPL wallets (Q1):");
  if (operators.length === 0) {
    console.log("  NONE. We must register our own operator. Budget 1.5 days.");
  } else {
    operators.forEach((o) => console.log(`  ${o}`));
    console.log("  → send spike payments to one of these.");
  }
  console.log();

  // --- the personal account ------------------------------------------------
  const personalAccount = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress],
  });
  console.log(`PersonalAccount: ${personalAccount}`);
  console.log(`  ${explorerAddress(personalAccount)}`);

  const code = await client.getCode({ address: personalAccount });
  const deployed = code !== undefined && code !== "0x";
  console.log(`  deployed: ${deployed ? "yes" : "no (precomputed CREATE2 address)"}`);

  if (deployed) {
    const owner = await client.readContract({
      address: personalAccount,
      abi: personalAccountAbi,
      functionName: "xrplOwner",
    });
    console.log(`  xrplOwner(): ${owner}`);
    console.log(`  round trip matches: ${owner === xrplAddress ? "YES" : "NO <-- investigate"}`);
  }

  // --- memo instruction nonce. Needed for any 0xFE / 0xFF user operation. ---
  const nonce = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getNonce",
    args: [personalAccount],
  });
  const pinnedExecutor = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getExecutor",
    args: [personalAccount],
  });
  console.log(`  memo nonce: ${nonce}`);
  console.log(`  pinned executor: ${pinnedExecutor}\n`);

  // --- FXRP ---------------------------------------------------------------
  const assetManager = await contractByName("AssetManagerFXRP");
  const fxrp = await client.readContract({
    address: assetManager,
    abi: [
      {
        type: "function",
        name: "fAsset",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
    ] as const,
    functionName: "fAsset",
  });
  const [fxrpBalance, fxrpDecimals, fxrpSymbol] = await Promise.all([
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "balanceOf", args: [personalAccount] }),
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: fxrp, abi: erc20Abi, functionName: "symbol" }),
  ]);
  console.log(`FXRP: ${fxrp}  (${fxrpSymbol}, ${fxrpDecimals} decimals)`);
  console.log(`  personal account balance: ${fxrpBalance}\n`);

  // --- Q4: are there live vaults on Coston2? ------------------------------
  const [vaultIds, vaultAddresses, vaultTypes] = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getVaults",
  });
  console.log(`Registered vaults (Q4): ${vaultIds.length}`);
  if (vaultIds.length === 0) {
    console.log("  NONE. Deploy our own minimal ERC-4626 and disclose it in the README.");
  }
  for (let i = 0; i < vaultIds.length; i++) {
    const addr = vaultAddresses[i]!;
    const shares = await client.readContract({
      address: addr,
      abi: erc4626Abi,
      functionName: "balanceOf",
      args: [personalAccount],
    });
    console.log(
      `  id=${vaultIds[i]} ${vaultTypeLabel[vaultTypes[i]!] ?? "unknown"} ${addr} shares=${shares}`,
    );
  }
  console.log();

  console.log("Paste into .env:");
  console.log(`  MASTER_ACCOUNT_CONTROLLER=${mac}`);
  console.log(`  FXRP_ADDRESS=${fxrp}`);
  if (operators[0]) console.log(`  OPERATOR_XRPL_ADDRESS=${operators[0]}`);
  if (vaultAddresses[0]) console.log(`  VAULT_ADDRESS=${vaultAddresses[0]}`);
  console.log();
}

main().catch((error: unknown) => {
  console.error("\nspike failed:", error);
  process.exit(1);
});
