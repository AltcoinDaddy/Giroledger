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
  /**
   * Pays gas for executions. Holds no user funds and has no special authority:
   * `execute()` is permissionless, so anyone can run a keeper.
   */
  KEEPER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32 byte hex private key"),

  RULE_REGISTRY_ADDRESS: addressSchema,
  RULE_EXECUTOR_ADDRESS: addressSchema,

  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(8081),

  /**
   * Gas budgeted per rule in a batch. NEVER let `eth_estimateGas` size a batch.
   *
   * `executeBatch` catches individual failures, so the outer call succeeds even
   * when an inner call runs out of gas. The estimator therefore converges on a
   * self-consistent starved figure: it hands over just enough gas for the inner
   * call to burn it all and revert, sees no revert at the top level, and calls
   * that the answer. Measured on Coston2: a real execution needs ~318k, the
   * estimator returned 316,693, and every batch executed nothing for 32 minutes.
   *
   * 700k gives roughly 2x headroom over the measured cost.
   */
  GAS_PER_RULE: z.coerce.bigint().min(200_000n).default(700_000n),
  /** Fixed overhead for calldata, the loop and the receipt. */
  GAS_BATCH_OVERHEAD: z.coerce.bigint().min(21_000n).default(150_000n),
  /**
   * Hard ceiling on a single batch transaction. Budgeting gas explicitly means
   * a large batch can exceed the block gas limit, so batches are trimmed to fit
   * and the remainder waits for the next tick.
   */
  MAX_TX_GAS: z.coerce.bigint().min(500_000n).default(6_000_000n),

  /**
   * A rule that simulates cleanly but never actually executes is quarantined
   * after this many consecutive no-op batches, so it cannot loop forever.
   */
  MAX_NOOP_STRIKES: z.coerce.number().int().min(1).default(3),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid keeper configuration.\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}
