// Normalize what the user typed into a safe https URL, or reject it.
// Blocks non-http(s) schemes, localhost and private network addresses (basic SSRF guard).

export type NormalizedUrl =
  | { ok: true; url: string; domain: string }
  | { ok: false };

const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export function normalizeUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false };

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false };

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || host.endsWith(".local") || !host.includes(".")) {
    return { ok: false };
  }

  return { ok: true, url: parsed.toString(), domain: host.replace(/^www\./, "") };
}
