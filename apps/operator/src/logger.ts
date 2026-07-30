import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Every log line that relates to a user instruction carries `xrplTx` as the
 * correlation ID. When the demo breaks at 2am, that field is how you trace one
 * payment from the XRPL through FDC to the Flare transaction.
 *
 * `transport` is spread conditionally rather than set to undefined, because
 * exactOptionalPropertyTypes rejects an explicit undefined here.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "operator" },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
