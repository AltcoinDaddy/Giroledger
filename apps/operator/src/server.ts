import { createServer, type Server } from "node:http";
import type { Hex } from "viem";
import type { InstructionStore, PendingInstruction } from "./store.js";
import type { Logger } from "./logger.js";

export interface OperatorHealth {
  startedAt: number;
  watching: string | null;
  seen: number;
  completed: number;
  failed: number;
  lastError: string | null;
}

/**
 * The operator's HTTP surface. Two routes, both small.
 *
 *   POST /instructions   hand over an instruction before paying for it
 *   GET  /health         is this thing alive and has it done anything
 *
 * CORS is wide open and there is no authentication. That is a deliberate
 * hackathon decision with a specific justification rather than laziness: an
 * instruction here is inert. It cannot be executed without a matching XRPL
 * payment signed by the account that owns it, and the memo on that payment
 * commits to this exact hash. The worst an attacker can do by posting junk is
 * fill a disk, which is why the store validates every field and the body size
 * is capped.
 *
 * It would still need auth and rate limiting before real money.
 */
export function startServer(args: {
  port: number;
  store: InstructionStore;
  health: OperatorHealth;
  log: Logger;
  /** Called after an instruction is accepted, so a waiting payment can finish. */
  onRegistered?: (pending: PendingInstruction) => void;
}): Server {
  const { port, store, health, log, onRegistered } = args;

  const server = createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      const body = {
        ok: health.watching !== null,
        ...health,
        pending: store.pending().length,
        stored: store.size(),
        heldPayments: store.orphanCount(),
        uptimeSeconds: Math.floor((Date.now() - health.startedAt) / 1000),
      };
      res
        .writeHead(health.watching !== null ? 200 : 503, {
          ...cors,
          "content-type": "application/json",
        })
        .end(JSON.stringify(body, null, 2));
      return;
    }

    if (req.method === "POST" && req.url === "/instructions") {
      let raw = "";
      let tooBig = false;
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
        // A valid instruction is a few kilobytes. Anything past 64 KB is not
        // one, and reading it would be the whole attack.
        if (raw.length > 64_000) {
          tooBig = true;
          res.writeHead(413, cors).end();
          req.destroy();
        }
      });
      req.on("end", () => {
        if (tooBig) return;
        try {
          const parsed = JSON.parse(raw) as {
            data?: Hex;
            memoData?: Hex;
            userOpHash?: Hex;
            totalCallValue?: string;
          };
          if (!parsed.data || !parsed.memoData || !parsed.userOpHash) {
            throw new Error("data, memoData and userOpHash are required");
          }
          const record = store.add({
            data: parsed.data,
            memoData: parsed.memoData,
            userOpHash: parsed.userOpHash,
            totalCallValue: parsed.totalCallValue ?? "0",
          });
          log.info({ userOpHash: record.userOpHash }, "instruction accepted");
          onRegistered?.(record);
          res
            .writeHead(202, { ...cors, "content-type": "application/json" })
            .end(JSON.stringify({ accepted: true, userOpHash: record.userOpHash }));
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log.warn({ reason }, "instruction rejected");
          res
            .writeHead(400, { ...cors, "content-type": "application/json" })
            .end(JSON.stringify({ accepted: false, reason }));
        }
      });
      return;
    }

    res.writeHead(404, cors).end();
  });

  server.listen(port, () => log.info({ port }, "operator http listening"));
  return server;
}
