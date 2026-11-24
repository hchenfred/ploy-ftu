// Shared, pure types for the artifact modules. No server-only code and no `@/` imports, so Node's test runner can
// load these files directly (they import each other with explicit `.ts` extensions).

/** What the artifact builders know about the business. Structurally compatible with SessionState["profile"]. */
export type ArtifactProfile = {
  name: string | null;
  domain: string | null;
  summary: string | null;
  description: string | null;
  brand: { name?: string | null; logoUrl?: string | null; colors?: string[] };
};

/** Every field optional, all the way down: what a streamed (still incomplete) object looks like. */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** The name to show for a business: the scraped name, the domain, or a neutral fallback. */
export function displayName(profile: ArtifactProfile): string {
  return (profile.name ?? profile.brand.name ?? profile.domain ?? "").trim() || "your business";
}

/** What a validator returns: the clean value, and how many parts had to come from the deterministic fallback. */
export type Validated<T> = { value: T; filled: number };

// --- tolerant readers for model output (unknown in, safe values out) ---
export const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asString = (v: unknown): string => (typeof v === "string" ? v : "");
