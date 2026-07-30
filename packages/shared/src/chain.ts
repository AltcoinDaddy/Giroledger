import { defineChain } from "viem";

/**
 * Flare Coston2 testnet.
 *
 * Source: https://dev.flare.network/network/overview
 * Faucet dispenses C2FLR, FXRP and USDT0: https://faucet.flare.network/coston2
 */
export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
  },
  testnet: true,
});

/**
 * The FlareContractRegistry has the same address on every Flare network.
 *
 * Every Flare system contract (FtsoV2, FdcHub, AssetManager, ...) MUST be
 * resolved through this registry rather than hardcoded. Addresses differ per
 * network and they do change.
 *
 * VERIFIED 27 July 2026 against the official docs, which list this same address
 * for Flare mainnet, Coston2, Songbird and Coston:
 * https://dev.flare.network/network/guides/flare-contracts-registry
 *
 * This is the only address in this codebase that is hardcoded, and the docs
 * explicitly sanction hardcoding this one because it is the trust anchor for
 * resolving everything else.
 */
export const FLARE_CONTRACT_REGISTRY =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

/** Registry lookup names, used with `getContractAddressByName`. */
export const RegistryName = {
  FtsoV2: "FtsoV2",
  FdcHub: "FdcHub",
  FdcVerification: "FdcVerification",
  AssetManagerFXRP: "AssetManagerFXRP",
} as const;

export const explorerTx = (hash: string): string =>
  `${coston2.blockExplorers.default.url}/tx/${hash}`;

export const explorerAddress = (address: string): string =>
  `${coston2.blockExplorers.default.url}/address/${address}`;

/** XRPL testnet defaults. Override via env in each service. */
export const XRPL_TESTNET_WSS = "wss://s.altnet.rippletest.net:51233" as const;
