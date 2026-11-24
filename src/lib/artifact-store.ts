import "server-only";
import { removeAssets } from "@/lib/artifact-storage";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ArtifactProfile } from "@/lib/artifact/types";
import type { ArtifactPromptInput } from "@/lib/artifact/prompt";
import type { GoalType } from "@/lib/goals";

// Database access for the draft artifact: one row per session (unique index on artifacts.session_id). The row's `data` is
// `{ meta, content }`; `meta` counts generations and holds a short-lived claim so two requests cannot generate at once.

export const MAX_GENERATIONS = 3;
const CLAIM_TTL_MS = 60_000;

export type ArtifactType = "ad_creative" | "page" | "playbook";
export type ArtifactSource = "model" | "fallback" | "card" | "fal";
export type ArtifactMeta = {
  generations: number;
  claimedAt: string | null;
  source: ArtifactSource | null;
  reason: string | null;
};
export type ArtifactRow = {
  id: string;
  type: ArtifactType;
  goal_type: string;
  data: { meta?: Partial<ArtifactMeta>; content?: unknown } | null;
  image_paths: string[];
  saved_at: string | null;
};

export async function getArtifact(sessionId: string): Promise<ArtifactRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("artifacts")
    .select("id, type, goal_type, data, image_paths, saved_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ArtifactRow | null;
}

export type ClaimResult =
  | { ok: true; id: string; generations: number; claimedAt: string; previousImagePaths: string[] }
  | { ok: false; reason: "limit" | "busy" | "saved" | "error" };

/**
 * Claim the right to generate: counts the generation (failures count too, which caps cost), and refuses when the cap is
 * reached, the artifact is already saved, or another generation started in the last minute. The claim is an optimistic
 * conditional write, so two simultaneous requests cannot both win.
 */
export async function claimGeneration(sessionId: string, goalType: GoalType, type: ArtifactType): Promise<ClaimResult> {
  const db = supabaseAdmin();
  const claimedAt = new Date().toISOString();
  try {
    const existing = await getArtifact(sessionId);
    if (!existing) {
      const { data, error } = await db
        .from("artifacts")
        .insert({
          session_id: sessionId,
          type,
          goal_type: goalType,
          data: { meta: { generations: 1, claimedAt, source: null, reason: null }, content: null },
        })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.code === "23505" ? "busy" : "error" }; // unique violation: another request won
      return { ok: true, id: data.id, generations: 1, claimedAt, previousImagePaths: [] };
    }

    if (existing.saved_at) return { ok: false, reason: "saved" };
    const sameGoal = existing.goal_type === goalType;
    const meta = existing.data?.meta ?? {};
    const previous = sameGoal ? (meta.generations ?? 0) : 0; // a leftover draft for another goal starts over
    if (previous >= MAX_GENERATIONS) return { ok: false, reason: "limit" };
    if (meta.claimedAt && Date.now() - Date.parse(meta.claimedAt) < CLAIM_TTL_MS) return { ok: false, reason: "busy" };

    // Only win if nobody changed the row since we read it (same generation count and the same claim stamp).
    let q = db
      .from("artifacts")
      .update({
        type,
        goal_type: goalType,
        data: { meta: { generations: previous + 1, claimedAt, source: null, reason: null }, content: sameGoal ? (existing.data?.content ?? null) : null },
      })
      .eq("id", existing.id)
      .eq("data->meta->>generations", String(meta.generations ?? 0));
    q = meta.claimedAt ? q.eq("data->meta->>claimedAt", meta.claimedAt) : q.is("data->meta->>claimedAt", null);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, reason: "error" };
    if (!data || data.length === 0) return { ok: false, reason: "busy" };
    return { ok: true, id: existing.id, generations: previous + 1, claimedAt, previousImagePaths: existing.image_paths ?? [] };
  } catch (err) {
    console.error("[artifact-store] claim failed:", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Save the result of a generation and release the claim. It only writes if the session is still in `building` and our
 * claim is still the current one, so a concurrent `step/back` or a newer generation is never overwritten. Returns false
 * when it did not write.
 */
export async function finishGeneration(args: {
  sessionId: string;
  id: string;
  claimedAt: string;
  generations: number;
  content: unknown;
  source: ArtifactSource;
  reason: string | null;
  /** Stored files for this artifact (the generated ad image); replaces the previous list. */
  imagePaths?: string[];
}): Promise<boolean> {
  const db = supabaseAdmin();
  try {
    const { data: session } = await db.from("sessions").select("status").eq("id", args.sessionId).maybeSingle();
    if (session?.status !== "building") return false; // the user went back while we were generating
    const { data, error } = await db
      .from("artifacts")
      .update({
        data: {
          meta: { generations: args.generations, claimedAt: null, source: args.source, reason: args.reason },
          content: args.content,
        },
        image_paths: args.imagePaths ?? [],
      })
      .eq("id", args.id)
      .eq("data->meta->>claimedAt", args.claimedAt)
      .select("id");
    if (error) {
      console.error("[artifact-store] finish failed:", error.message);
      return false;
    }
    return !!data && data.length > 0;
  } catch (err) {
    console.error("[artifact-store] finish failed:", err);
    return false;
  }
}

/** What the page, playbook and ad builders need about the business, read from what step 1 saved. */
export async function loadArtifactInput(
  sessionId: string,
): Promise<{ profile: ArtifactProfile; prompt: ArtifactPromptInput; photoPath: string | null } | null> {
  const { data, error } = await supabaseAdmin()
    .from("business_profiles")
    .select("url, name, summary, brand, content")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  let domain: string | null = null;
  try {
    domain = data.url ? new URL(data.url).hostname.replace(/^www\./, "") : null;
  } catch {
    domain = null;
  }
  const content = (data.content ?? {}) as { digest?: string; description?: string; photo?: { path?: string } };
  const brand = (data.brand ?? {}) as { name?: string | null; logoUrl?: string | null; colors?: string[] };
  return {
    photoPath: typeof content.photo?.path === "string" ? content.photo.path : null,
    profile: {
      name: data.name ?? null,
      domain,
      summary: data.summary ?? null,
      description: content.description ?? null,
      brand: { name: brand.name ?? null, logoUrl: brand.logoUrl ?? null, colors: brand.colors ?? [] },
    },
    prompt: {
      name: data.name ?? null,
      domain,
      summary: data.summary ?? null,
      description: content.description ?? null,
      digest: content.digest ?? null,
    },
  };
}

/** Whether a generation claim is still fresh (someone is generating right now). */
export function isClaimActive(row: ArtifactRow | null): boolean {
  const at = row?.data?.meta?.claimedAt;
  return !!at && Date.now() - Date.parse(at) < CLAIM_TTL_MS;
}

/**
 * Delete the draft artifact, its stored images and the uploaded photo, and forget the photo on the profile. Used when the user goes
 * back before saving. Database errors are logged and swallowed (best effort), so going back never fails on cleanup.
 */
export async function cleanupDraft(sessionId: string): Promise<void> {
  const db = supabaseAdmin();
  try {
    const row = await getArtifact(sessionId);
    const { data: profile } = await db.from("business_profiles").select("content").eq("session_id", sessionId).maybeSingle();
    const content = (profile?.content ?? {}) as Record<string, unknown> & { photo?: { path?: string } };
    const paths = [...(row?.image_paths ?? []), ...(typeof content.photo?.path === "string" ? [content.photo.path] : [])];

    if (row) {
      const { error } = await db.from("artifacts").delete().eq("id", row.id).is("saved_at", null); // never delete a saved artifact
      if (error) console.error("[artifact-store] cleanup: deleting the draft failed:", error.message);
    }
    if (content.photo) {
      const { photo: _photo, ...rest } = content;
      void _photo;
      await db.from("business_profiles").update({ content: rest }).eq("session_id", sessionId);
    }
    await removeAssets(paths);
  } catch (err) {
    console.error("[artifact-store] cleanup failed:", err);
  }
}

