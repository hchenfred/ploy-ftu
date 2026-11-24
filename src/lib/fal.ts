import "server-only";
import { sniffImageType, type ImageType } from "@/lib/artifact/ad";
import type { FalConfig } from "@/lib/artifact/fal-client";
import { normalizeUrl } from "@/lib/url";

const DEFAULT_MODEL = "google/nano-banana-2.1/edit";
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** fal's settings from the environment, or null when there is no key (the ad then uses the text-only card). */
export function falConfig(): FalConfig | null {
  const key = process.env.FAL_KEY?.trim();
  if (!key) return null;
  return {
    key,
    model: process.env.FAL_MODEL_ID?.trim() || DEFAULT_MODEL,
    baseUrl: process.env.FAL_BASE_URL?.trim() || "https://queue.fal.run", // FAL_BASE_URL is a test seam only
  };
}

export type Download = { ok: true; bytes: Uint8Array; type: ImageType } | { ok: false; reason: string };

/**
 * Download the image fal produced so we can copy it into our own storage (fal URLs are not durable). https only, no private
 * addresses, a 15 s timeout, a size cap, and the real image type must be recognized from the bytes.
 */
export async function downloadGeneratedImage(url: string): Promise<Download> {
  const target = normalizeUrl(url);
  if (!target.ok || new URL(target.url).protocol !== "https:") return { ok: false, reason: "the output URL is not a public https URL" };
  try {
    const res = await fetch(target.url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!res.ok) return { ok: false, reason: `download failed with ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_OUTPUT_BYTES) return { ok: false, reason: "the output image is too large" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_OUTPUT_BYTES) return { ok: false, reason: "the output image is empty or too large" };
    const type = sniffImageType(bytes);
    return type ? { ok: true, bytes, type } : { ok: false, reason: "the output is not a JPEG, PNG or WebP image" };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 120) };
  }
}
