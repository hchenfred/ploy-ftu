import { cleanModelText } from "../goals.ts";

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
// Used only to read what the MODEL wrote, so it also removes a leaked fragment of the model's own JSON (see cleanModelText).
export const asString = (v: unknown): string => (typeof v === "string" ? cleanModelText(v) : "");

// --- tolerant key lookup: a weak model may answer with its own capitalisation or a synonym ("Title", "Tasks", "Timing") ---
const canon = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The value of the first of `names` found in `obj`, ignoring case, spaces, dashes and underscores; undefined if none. */
export function field(obj: unknown, ...names: string[]): unknown {
  const o = asObject(obj);
  if (!o) return undefined;
  const byCanon = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) if (!byCanon.has(canon(k))) byCanon.set(canon(k), v);
  for (const n of names) {
    const v = byCanon.get(canon(n));
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Parse a JSON object out of raw model text, even when it is wrapped in a code fence or has prose around it. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through: try the outermost {...}
  }
  const a = trimmed.indexOf("{");
  const b = trimmed.lastIndexOf("}");
  if (a === -1 || b <= a) return undefined;
  try {
    return JSON.parse(trimmed.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

