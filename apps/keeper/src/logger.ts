import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

// `transport` is spread conditionally rather than set to undefined, because
// exactOptionalPropertyTypes rejects an explicit undefined here.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "keeper" },
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
