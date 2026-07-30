import baseConfig from "./hardhat.config.js";

/**
 * Fork config for `pnpm contracts:test:fork`.
 *
 * WHY THIS FILE EXISTS, because it is not obvious:
 *
 * Hardhat 3 Solidity tests do NOT fork based on `--network`. They read their
 * own config at `test.solidity.profiles.default.forking`, and there is no flag
 * to select a different test profile. So the only ways to fork are to make
 * every test run fork, or to point one script at a different config file.
 *
 * The second is better. `pnpm contracts:test` stays fast and works offline,
 * and `pnpm contracts:test:fork` reaches the network deliberately.
 *
 * Getting this wrong is quiet rather than loud: without forking, the real
 * Coston2 addresses simply have no code, the fork tests skip, and the suite
 * still reports green. That is exactly why RuleEngineFork.t.sol checks
 * `extcodesize` rather than trusting configuration.
 */
export default {
  ...baseConfig,
  test: {
    solidity: {
      forking: {
        url:
          process.env.COSTON2_RPC_URL ??
          "https://coston2-api.flare.network/ext/C/rpc",
      },
    },
  },
};
