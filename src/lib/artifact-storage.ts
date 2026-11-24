import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

// The private `assets` bucket: nothing in it is public. Browsers and fal only ever get short-lived signed URLs.
const BUCKET = "assets";

export async function uploadAsset(path: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) console.error("[artifact-storage] upload failed:", error.message);
  return !error;
}

/** A signed read URL for a stored file, or null if it could not be created. */
export async function signedAssetUrl(path: string, ttlSeconds: number): Promise<string | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Best effort: failing to delete a file never breaks the flow. */
export async function removeAssets(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin().storage.from(BUCKET).remove(paths);
  if (error) console.error("[artifact-storage] remove failed:", error.message);
}
