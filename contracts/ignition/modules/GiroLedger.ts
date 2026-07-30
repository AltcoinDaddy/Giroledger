import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the GiroLedger rule engine.
 *
 *   npx hardhat ignition deploy ignition/modules/GiroLedger.ts \
 *     --network coston2 \
 *     --parameters ignition/params.coston2.json
 *
 * Required parameters:
 *   owner  - admin address for the vault allowlist and the pause valve
 *   asset  - FXRP address, read from AssetManagerFXRP.fAsset()
 *            (run `pnpm --filter @giroledger/operator spike:resolve` to get it)
 *   vault  - an allowlisted ERC-4626 vault, from MasterAccountController.getVaults()
 *
 * The module wires the executor into the registry and allowlists one vault, so
 * the deployment is usable immediately rather than needing two manual follow-up
 * transactions that are easy to forget under deadline pressure.
 */
export default buildModule("GiroLedgerModule", (m) => {
  const owner = m.getParameter<string>("owner");
  const asset = m.getParameter<string>("asset");
  const vault = m.getParameter<string>("vault");

  const registry = m.contract("RuleRegistry", [owner]);
  const executor = m.contract("RuleExecutor", [registry, asset, owner]);

  // No `from` here. Ignition sends from the deploying account by default, and
  // the `owner` parameter is that same account. Passing `from: owner` fails
  // because it is a module parameter object rather than a literal address.
  // If you ever set `owner` to something other than the deployer, these two
  // calls must be made separately by that owner.

  // The registry only accepts markExecuted from this address.
  m.call(registry, "setExecutor", [executor]);

  // Without an allowlist entry, createRule reverts with VaultNotAllowed.
  m.call(registry, "setVaultAllowed", [vault, true]);

  return { registry, executor };
});
