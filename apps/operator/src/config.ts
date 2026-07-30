import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20 byte hex address");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  COSTON2_RPC_URL: z
    .string()
    .url()
    .default("https://coston2-api.flare.network/ext/C/rpc"),
  /** Submits attestation proofs. Pays gas. Never a user key. */
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32 byte hex private key"),

  XRPL_WSS_URL: z.string().url().default("wss://s.altnet.rippletest.net:51233"),
  /**
   * Flare's public operator wallet, kept only for reference and diagnostics.
   *
   * The watcher does NOT subscribe to this. Instruction payments go to the
   * FAssets direct-minting address, which is read live from AssetManagerFXRP.
   * Subscribing here is what made the old operator watch an account no user
   * ever pays.
   */
  OPERATOR_XRPL_ADDRESS: z.string().min(25),

  RULE_REGISTRY_ADDRESS: addressSchema,
  RULE_EXECUTOR_ADDRESS: addressSchema,
  FXRP_ADDRESS: addressSchema,

  /** Where pending instructions and processed payments are persisted. */
  STATE_DIR: z.string().default("./data"),
  /**
   * HTTP port for POST /instructions and GET /health.
   *
   * Deliberately NOT called HEALTH_PORT. The keeper already uses that name in
   * the same .env, and the later line wins, so a shared name puts both
   * services on the same port and one fails to bind.
   */
  OPERATOR_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),

  // --- Flare Data Connector -------------------------------------------------
  FDC_VERIFIER_URL: z.string().url().default("https://fdc-verifiers-testnet.flare.network"),
  FDC_VERIFIER_API_KEY: z.string().min(1),
  FDC_DA_LAYER_URL: z.string().url(),
  FDC_DA_LAYER_API_KEY: z.string().min(1),

  /**
   * Voting round timing, used to derive the roundId from a block timestamp.
   *
   * The defaults are the Coston values printed in the FDC guide. They are very
   * likely wrong for Coston2. Confirm them (task S-13, question Q5) before
   * trusting a computed roundId, because a wrong epoch length fails silently:
   * the proof simply never appears for the round you asked about.
   */
  FIRST_VOTING_ROUND_START_TS: z.coerce.number().int().default(1658429955),
  VOTING_EPOCH_DURATION_SECONDS: z.coerce.number().int().positive().default(90),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid operator configuration.\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}
