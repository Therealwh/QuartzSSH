/**
 * Classification of SSH key-exchange algorithm names for the status-bar
 * post-quantum indicator (spec 29.3). The negotiated name comes from the
 * backend (`ssh:connected` event / `ssh_kex_info` command), which records
 * it in russh's `Handler::kex_done` callback.
 */

export type KexClass = "pq" | "classic";

export interface KexBadge {
  kind: KexClass;
  /** The algorithm name shown in the badge. */
  kex: string;
}

/** A negotiated KEX name is post-quantum when it embeds an ML-KEM hybrid
 * (russh names it `mlkem768x25519-sha256`); everything else is classical. */
export function classifyKex(kex: string): KexClass {
  return kex.includes("mlkem") ? "pq" : "classic";
}

/** Pick the badge for a set of active sessions from their negotiated KEX
 * names (`undefined` = not known yet). Returns null while nothing is known.
 * The badge is PQ only when every known session negotiated a post-quantum
 * KEX; a single classical session turns it conservative ("Classic"), with
 * that algorithm's name shown. */
export function selectKexBadge(kexes: Array<string | undefined>): KexBadge | null {
  const known = kexes.filter((k): k is string => typeof k === "string");
  if (known.length === 0) return null;
  const firstClassic = known.find((k) => classifyKex(k) === "classic");
  if (firstClassic !== undefined) return { kind: "classic", kex: firstClassic };
  return { kind: "pq", kex: known[0] };
}
