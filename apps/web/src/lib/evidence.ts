import type { Address, Hex } from "viem";

/**
 * The claims the landing page makes, in one place so they can be checked.
 *
 * WHY THIS IS NOT READ LIVE. The landing page's job is to be up and fast when
 * a judge opens it. Fetching this over RPC would put a spinner, or an error,
 * in front of the first impression, and would drag the crypto library into a
 * page that otherwise needs none of it.
 *
 * WHY IT IS NOT SIMPLY HARDCODED EITHER. Stale explorer links are worse than a
 * spinner, because they look like a lie rather than a hiccup. So:
 *
 *   ADDRESSES come from the same VITE_ variables `/app` uses. They cannot
 *   disagree with the running app, and they follow a redeploy automatically.
 *
 *   TRANSACTIONS stay literal, because a transaction is a historical fact and
 *   genuinely does not change. They are verified rather than trusted:
 *   `pnpm verify-landing` checks every one against Coston2 and fails loudly.
 *   Run it before filming and before submitting.
 */

export const REGISTRY = import.meta.env["VITE_RULE_REGISTRY_ADDRESS"] as Address | undefined;
export const EXECUTOR = import.meta.env["VITE_RULE_EXECUTOR_ADDRESS"] as Address | undefined;

/** The account in every example below. Derived from the XRPL address, not chosen. */
export const ACCOUNT = "0xe29c2E182bFB46977BA574f80005ac28C8720dab" as Address;
export const XRPL_ADDRESS = "rn5Bu7Uce1dUS83NoAHoP3GBtniShkNtaL";

/** FAssets direct-minting payment address. Every instruction payment goes here. */
export const CORE_VAULT = "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p";

/** The real memo that created the rule in TX.create. 42 bytes. */
export const REAL_MEMO =
  "FE00000000000000000033E1A24B4D6E09909F02E132CEADB422EDD25E238567E7B13331FEFC86247162";

export const TX = {
  smartAccount: "0xeda8fab5dd91b353cafa63ffb8f8173f9dbbf55584b1d584e77bfe10b6a5ab89",
  create: "0x332cb1149a1dc09b2abde2cb3b26f80b1134f9db1908d2e1074057c348c44770",
  execute: "0x1c5d1a15c287a40c5cbd7923a592d1e7124c734027f19ba6293b89d0eee9d3c0",
  cancel: "0xdf26dfa5feb92473529773632fd1daca4ef2b564ad12772c15c6b26b376ab28b",
  /**
   * The operator completing a payment on its own, with nobody watching.
   * Replaced an earlier hash that recorded the same step done by hand.
   */
  operatorCompleted: "0x8ef9a209056ecca4d2d23101d15b75a3b1570e2750a0f17e96e9792f78da5f72",
} as const satisfies Record<string, Hex>;

/** Real executions of TX.create. 1 FXRP in, exactly 1,000,000 shares out. */
export const SHOT_ROWS = [
  { state: "Executed", moved: "1 FXRP", shares: "1000000", hash: "0x1c5d1a15…d3c0" },
  { state: "Executed", moved: "1 FXRP", shares: "1000000", hash: "0xc2ea36df…5861" },
  { state: "Executed", moved: "1 FXRP", shares: "1000000", hash: "0x005752f8…d457" },
  { state: "Executed", moved: "1 FXRP", shares: "1000000", hash: "0x835622ea…b7d5" },
] as const;

const EXPLORER = "https://coston2-explorer.flare.network";
export const tx = (h: string): string => `${EXPLORER}/tx/${h}`;
export const addr = (a: string): string => `${EXPLORER}/address/${a}`;
