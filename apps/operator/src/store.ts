import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keccak256, type Hex } from "viem";

/**
 * Pending instructions, keyed by the hash the XRPL memo commits to.
 *
 * WHY THIS EXISTS AT ALL. A `0xFE` memo is 42 bytes and carries only
 * `keccak256(userOperation)`. It does not carry the operation. An operator
 * watching the ledger therefore sees a payment saying "execute the thing whose
 * hash is X" and has no way to work out what X was. Flare's own docs describe
 * the payload as "delivered off-chain to the executor"; this is that delivery.
 *
 * So the flow has a step the old design missed: whoever builds the instruction
 * must hand it to the operator BEFORE the payment lands. The web app posts it
 * when it displays the memo.
 *
 * Persisted to disk because the alternative is losing every in-flight payment
 * on restart, and an in-flight payment that cannot be completed is a user's XRP
 * sitting at the Core Vault.
 */

export interface PendingInstruction {
  /** keccak256 of `data`. The last 32 bytes of the memo. */
  userOpHash: Hex;
  /** The full PackedUserOperation. This is the part the memo cannot carry. */
  data: Hex;
  /** Sum of call values. Forwarded as msg.value on submission. */
  totalCallValue: string;
  /** The 42-byte memo, kept so we can compare against what actually arrived. */
  memoData: Hex;
  addedAt: number;
  /** Set once submitted, so a restart does not resubmit. */
  completedTx?: Hex;
  /** XRPL transaction that consumed it. */
  xrplTx?: string;
}

/**
 * A payment that arrived carrying a hash we had never been given.
 *
 * Kept rather than discarded because the ordering is not guaranteed: a user can
 * pay before the browser finishes registering, the operator can be restarting,
 * or the network can reorder the two. Without this, any of those strands the
 * payment until someone completes it by hand.
 */
export interface OrphanPayment {
  userOpHash: Hex;
  xrplTx: string;
  seenAt: number;
}

/**
 * How long a payment is held before it is forgotten, and how many at once.
 *
 * Both limits exist because the Core Vault is a SHARED address: every
 * direct-minting payment on the network arrives there, from anyone. Most of
 * what this operator sees belongs to other people and can never be completed,
 * because their instruction bodies were handed to their operator, not ours.
 *
 * Without a bound the file would grow forever with strangers' payment hashes.
 * An hour is generous next to the two to three minutes a real handover takes,
 * and covers a restart or a slow browser.
 */
const ORPHAN_TTL_MS = 60 * 60 * 1000;
const ORPHAN_MAX = 500;

interface FileShape {
  version: 1;
  instructions: PendingInstruction[];
  orphans?: OrphanPayment[];
}

export class InstructionStore {
  private readonly path: string;
  private readonly byHash = new Map<string, PendingInstruction>();
  /** Payments seen before their instruction was handed over. */
  private readonly orphans = new Map<string, OrphanPayment>();

  constructor(stateDir: string) {
    this.path = join(stateDir, "instructions.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      for (const i of parsed.instructions) this.byHash.set(i.userOpHash.toLowerCase(), i);
      for (const o of parsed.orphans ?? []) this.orphans.set(o.userOpHash.toLowerCase(), o);
      // A restart is a good moment to shed anything stale.
      this.pruneOrphans();
    } catch {
      // No file yet, or it is unreadable. Starting empty is correct: the store
      // is a cache of things not yet on chain, never a source of truth.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const body: FileShape = {
      version: 1,
      instructions: [...this.byHash.values()],
      orphans: [...this.orphans.values()],
    };
    writeFileSync(this.path, JSON.stringify(body, null, 2));
  }

  /**
   * Accept an instruction, refusing anything self-inconsistent.
   *
   * The operator is untrusted infrastructure: it cannot forge an instruction,
   * because the memo the user signed commits to a specific hash. But it can be
   * fed junk, so everything checkable is checked here rather than three minutes
   * later when an attestation has already been spent.
   */
  add(input: {
    data: Hex;
    memoData: Hex;
    userOpHash: Hex;
    totalCallValue: string;
  }): PendingInstruction {
    const computed = keccak256(input.data);
    if (computed.toLowerCase() !== input.userOpHash.toLowerCase()) {
      throw new Error(
        `userOpHash does not match keccak256(data): claimed ${input.userOpHash}, computed ${computed}`,
      );
    }

    const memo = input.memoData.toLowerCase();
    if ((memo.length - 2) / 2 !== 42) {
      throw new Error(`memo must be 42 bytes, got ${(memo.length - 2) / 2}`);
    }
    if (!memo.startsWith("0xfe")) {
      throw new Error(`memo must start with the 0xFE opcode, got ${memo.slice(0, 4)}`);
    }
    // Last 32 bytes of the memo are the hash. If they disagree, the memo the
    // user is about to pay with does not commit to this operation.
    if (!memo.endsWith(computed.slice(2).toLowerCase())) {
      throw new Error("memo does not commit to this operation's hash");
    }

    const existing = this.byHash.get(computed.toLowerCase());
    if (existing) return existing;

    const record: PendingInstruction = {
      userOpHash: computed,
      data: input.data,
      memoData: input.memoData,
      totalCallValue: input.totalCallValue,
      addedAt: Date.now(),
    };
    this.byHash.set(computed.toLowerCase(), record);
    this.persist();
    return record;
  }

  /** Look up by the hash carried in an arriving memo. */
  find(userOpHash: Hex): PendingInstruction | undefined {
    return this.byHash.get(userOpHash.toLowerCase());
  }

  /** Remember a payment whose instruction we do not have yet. */
  recordOrphan(userOpHash: Hex, xrplTx: string): void {
    const key = userOpHash.toLowerCase();
    if (this.orphans.has(key)) return;
    this.orphans.set(key, { userOpHash, xrplTx, seenAt: Date.now() });
    this.pruneOrphans();
    this.persist();
  }

  /**
   * Drop held payments that are too old, then trim to a hard ceiling.
   *
   * Oldest first, because a payment whose instruction has not arrived in an
   * hour is almost certainly someone else's. Forgetting one costs nothing that
   * cannot be recovered: the payment is still on the XRPL, and a later
   * registration of the matching instruction will complete it the moment the
   * payment is seen again, or it can be finished by hand.
   */
  private pruneOrphans(): void {
    const cutoff = Date.now() - ORPHAN_TTL_MS;
    for (const [key, o] of this.orphans) {
      if (o.seenAt < cutoff) this.orphans.delete(key);
    }
    if (this.orphans.size <= ORPHAN_MAX) return;
    const bySeen = [...this.orphans.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [key] of bySeen.slice(0, this.orphans.size - ORPHAN_MAX)) {
      this.orphans.delete(key);
    }
  }

  /**
   * Did a payment for this instruction already arrive?
   *
   * Called when an instruction is registered, so a late handover still gets
   * completed instead of leaving the user's XRP at the Core Vault.
   */
  takeOrphan(userOpHash: Hex): OrphanPayment | undefined {
    const key = userOpHash.toLowerCase();
    const found = this.orphans.get(key);
    if (found) {
      this.orphans.delete(key);
      this.persist();
    }
    return found;
  }

  orphanCount(): number {
    return this.orphans.size;
  }

  markCompleted(userOpHash: Hex, completedTx: Hex, xrplTx: string): void {
    const record = this.byHash.get(userOpHash.toLowerCase());
    if (!record) return;
    record.completedTx = completedTx;
    record.xrplTx = xrplTx;
    this.persist();
  }

  pending(): PendingInstruction[] {
    return [...this.byHash.values()].filter((i) => i.completedTx === undefined);
  }

  size(): number {
    return this.byHash.size;
  }
}

/**
 * Pull the committed hash out of a 42-byte `0xFE` memo.
 * Layout: 0xFE | walletId (1B) | executorFeeUBA (8B) | keccak256 (32B).
 */
export function memoUserOpHash(memoData: Hex): Hex | null {
  const body = memoData.startsWith("0x") ? memoData.slice(2) : memoData;
  if (body.length !== 84) return null;
  if (body.slice(0, 2).toLowerCase() !== "fe") return null;
  return `0x${body.slice(20)}`.toLowerCase() as Hex;
}
