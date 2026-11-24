import { z } from "zod";
import { sniffImageType, imageContentType, imageExtension } from "@/lib/artifact/ad";
import { removeAssets, uploadAsset } from "@/lib/artifact-storage";
import { logEvent } from "@/lib/events";
import { GOAL_CATALOG } from "@/lib/goals";
import { loadSessionState } from "@/lib/session-state";
import { supabaseAdmin } from "@/lib/supabase-server";

// The browser downsizes the photo first (about 1,600 px, JPEG), so a real upload is far under this. A serverless function also
// accepts only a limited request body, so this cap is the one we can promise to enforce.
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

// POST /api/uploads/photo (multipart: sessionId, file): the product photo for the ad. The real image type is read from the first
// bytes (the filename and the declared type are never trusted); the file goes into the private `assets` bucket and its path is
// recorded on the profile. Nothing here is public: the photo is only ever shared as a short-lived signed URL.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const sessionId = z.uuid().safeParse(form?.get("sessionId"));
  const file = form?.get("file");
  if (!form || !sessionId.success || !(file instanceof File)) return Response.json({ error: "Invalid request" }, { status: 400 });

  if (file.size === 0) return Response.json({ error: "unsupported_type" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "too_large" }, { status: 413 });

  const current = await loadSessionState(sessionId.data);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not save the photo" }, { status: 500 });
  }
  const { status, goal } = current.state;
  // Only the ad takes a photo, and only while the user is building it.
  if (status !== "building" || !goal || GOAL_CATALOG[goal.goalType].artifactType !== "ad_creative") {
    return Response.json({ error: "wrong_step" }, { status: 409 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return Response.json({ error: "unsupported_type" }, { status: 400 }); // JPEG, PNG or WebP only

  const db = supabaseAdmin();
  const { data: profile, error: readError } = await db
    .from("business_profiles")
    .select("content")
    .eq("session_id", sessionId.data)
    .maybeSingle();
  if (readError || !profile) return Response.json({ error: "Could not save the photo" }, { status: 500 });
  const content = (profile.content ?? {}) as Record<string, unknown> & { photo?: { path?: string } };

  const path = `${sessionId.data}/ad/reference.${imageExtension(type)}`;
  if (!(await uploadAsset(path, bytes, imageContentType(type)))) {
    return Response.json({ error: "Could not save the photo" }, { status: 500 });
  }
  const { error } = await db
    .from("business_profiles")
    .update({ content: { ...content, photo: { path, bytes: bytes.length } }, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId.data);
  if (error) {
    await removeAssets([path]);
    return Response.json({ error: "Could not save the photo" }, { status: 500 });
  }
  // A new photo of another type replaces the old file under a different name: remove the old one.
  if (content.photo?.path && content.photo.path !== path) await removeAssets([content.photo.path]);

  await logEvent(sessionId.data, "photo_uploaded", { bytes: bytes.length, type });
  return Response.json({ ok: true, bytes: bytes.length });
}
