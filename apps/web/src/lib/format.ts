export function short(addr: string, lead = 6, tail = 4): string {
  if (addr.length <= lead + tail + 2) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function units(value: bigint, decimals: number, maxFraction = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fracStr.length > 0
    ? `${whole.toLocaleString("en-US")}.${fracStr}`
    : whole.toLocaleString("en-US");
}

export function toUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (trimmed === "") return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function duration(seconds: number): string {
  if (seconds % 604800 === 0) return plural(seconds / 604800, "week");
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function relativeTime(unixSeconds: bigint, now = Date.now()): string {
  const delta = Number(unixSeconds) * 1000 - now;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return delta >= 0 ? "any moment" : "just now";
  if (mins < 60) return delta >= 0 ? `in ${plural(mins, "min")}` : `${plural(mins, "min")} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return delta >= 0 ? `in ${plural(hours, "hour")}` : `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  return delta >= 0 ? `in ${plural(days, "day")}` : `${plural(days, "day")} ago`;
}

/** Loose XRPL classic address check. Full validation happens on-chain. */
export function looksLikeXrplAddress(value: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value.trim());
}
