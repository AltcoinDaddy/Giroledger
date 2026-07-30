import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * Hardhat 3 + viem.
 *
 * Solidity tests live next to the contracts as `*.t.sol` and use forge-std,
 * so we get cheatcodes (`vm.prank`, `expectRevert`, `expectEmit`) and native
 * fuzzing without needing Foundry installed.
 *
 * Secrets are read through `configVariable`, which resolves from the Hardhat
 * keystore or the environment. Nothing sensitive belongs in this file.
 *   npx hardhat keystore set COSTON2_RPC_URL
 *   npx hardhat keystore set DEPLOYER_PRIVATE_KEY
 */
const COSTON2_RPC =
  process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],

  paths: {
    sources: "src",
    tests: { solidity: "src" },
  },

  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },

  networks: {
    // Local EDR chain. Used by `npx hardhat test solidity`.
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },

    /**
     * NOTE: forking for Solidity tests is NOT configured here. Hardhat 3
     * Solidity tests ignore `--network` and read `test.solidity.forking`
     * instead. See hardhat.fork.config.ts, used by `pnpm contracts:test:fork`.
     */
    coston2: {
      type: "http",
      chainType: "l1",
      chainId: 114,
      url: COSTON2_RPC,
      // The one thing that must never be defaulted.
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },

  /**
   * Coston2 is not in hardhat-verify's built-in explorer list, so verification
   * fails with HHE80000 "network with chain id 114 is not supported" until the
   * explorer is described here.
   */
  chainDescriptors: {
    114: {
      name: "Flare Testnet Coston2",
      blockExplorers: {
        blockscout: {
          name: "Coston2 Explorer",
          url: "https://coston2-explorer.flare.network",
          apiUrl: "https://coston2-explorer.flare.network/api",
        },
      },
    },
  },

  // The Coston2 explorer is Blockscout. Etherscan has no Coston2 instance.
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false },
  },
});
