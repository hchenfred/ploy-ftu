import { createTextStreamResponse, Output, streamText, toTextStream } from "ai";
import { z } from "zod";
import { isRateLimitError, isTimeoutError } from "@/lib/ai-errors";
import { buildAdHeadline, type AdCreative } from "@/lib/artifact/ad";
import { fallbackPage, pageModelSchema, validatePage } from "@/lib/artifact/page";
import { fallbackPlaybook, playbookModelSchema, validatePlaybook } from "@/lib/artifact/playbook";
import { buildArtifactInput } from "@/lib/artifact/prompt";
import { deriveTheme } from "@/lib/artifact/theme";
import { extractJson } from "@/lib/artifact/types";
import { claimGeneration, finishGeneration, loadArtifactInput, type ArtifactSource } from "@/lib/artifact-store";
import { logEvent } from "@/lib/events";
import { GOAL_CATALOG } from "@/lib/goals";
import { PAGE_PROMPT, PLAYBOOK_PROMPT } from "@/lib/prompts";
import { loadSessionState } from "@/lib/session-state";

// A streamed answer for a page or playbook can take a while: allow up to 60 s on Vercel.
export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  headline: z.string().trim().max(60).optional(), // the ad headline: the user's own text (ad only)
});

const failureReason = (err: unknown) => (isRateLimitError(err) ? "rate_limited" : isTimeoutError(err) ? "timeout" : "unknown");

// POST /api/artifact/generate: make the draft artifact for the chosen goal.
// - plan_campaign / get_leads: ONE streamed model request (streamText + Output.object). The client sees partial objects as
//   they arrive; the SERVER validates, clips and saves the final one, and the saved row exists before the response closes.
// - launch_product: the text-only branded ad card for now (the photo and fal come in the next step). No model request.
// Never an error page for an expected failure: a failed or invalid model answer saves the deterministic fallback instead.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, headline } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not load the session" }, { status: 500 });
  }
  const { status, goal } = current.state;
  if (status !== "building" || !goal) return Response.json({ error: "wrong_step" }, { status: 409 });

  const artifactType = GOAL_CATALOG[goal.goalType].artifactType;
  const claim = await claimGeneration(sessionId, goal.goalType, artifactType);
  if (!claim.ok) {
    return claim.reason === "error"
      ? Response.json({ error: "Could not start" }, { status: 500 })
      : Response.json({ error: claim.reason }, { status: 409 }); // limit | busy | saved
  }

  const started = Date.now();
  const input = await loadArtifactInput(sessionId).catch(() => null);
  const done = async (content: unknown, source: ArtifactSource, reason: string | null, detail?: string) => {
    const saved = await finishGeneration({
      sessionId,
      id: claim.id,
      claimedAt: claim.claimedAt,
      generations: claim.generations,
      content,
      source,
      reason,
    });
    await logEvent(sessionId, "artifact_generated", {
      goalType: goal.goalType,
      artifactType,
      source,
      ms: Date.now() - started,
      generation: claim.generations,
      saved,
    });
    if (reason) {
      await logEvent(sessionId, "tool_failed", { tool: "generateArtifact", reason, detail, goalType: goal.goalType });
    }
  };

  // No usable profile (should not happen after step 1): save a neutral fallback so the user is never stuck.
  const profile = input?.profile ?? { name: null, domain: null, summary: null, description: null, brand: {} };

  // ---- launch_product: the text-only branded card (no model request) ----
  if (artifactType === "ad_creative") {
    const card: AdCreative = {
      kind: "ad_creative",
      source: "card",
      headline: buildAdHeadline(headline, profile.name ?? profile.brand.name ?? profile.domain),
      accent: deriveTheme(profile.brand.colors).accent,
    };
    await done(card, "card", null);
    return Response.json({ ok: true, source: "card" });
  }

  // ---- plan_campaign / get_leads: one streamed model request ----
  const isPage = artifactType === "page";
  const prompt = input ? buildArtifactInput(input.prompt) : null;
  const fallback = () => (isPage ? fallbackPage(profile) : fallbackPlaybook(profile));
  const validate = (raw: unknown) => (isPage ? validatePage(raw, profile) : validatePlaybook(raw, profile));

  if (!prompt) {
    await done(fallback(), "fallback", "no_profile");
    return Response.json({ ok: true, source: "fallback" });
  }

  let streamError: unknown;
  const result = streamText({
    model: process.env.MODEL_ID ?? "anthropic/claude-sonnet-5.5", // via Vercel AI Gateway
    system: isPage ? PAGE_PROMPT : PLAYBOOK_PROMPT,
    prompt,
    output: Output.object({ schema: isPage ? pageModelSchema : playbookModelSchema }),
    abortSignal: AbortSignal.timeout(50_000), // a reasoning model can think for 45 s before it answers
    maxRetries: 1,
    onError: ({ error }) => {
      streamError = error;
      console.error("[artifact/generate] stream error:", error);
    },
  });

  // When the model's text stream ends, validate and save BEFORE the response closes, so the client's refresh finds the row.
  const saveBeforeClose = new TransformStream<string, string>({
    async flush() {
      try {
        let raw: unknown;
        try {
          raw = await result.output; // parsed against our schema by the SDK
        } catch (err) {
          // A weak model may ignore the schema's key names. Our validators are tolerant, so try the raw text before giving up.
          try {
            raw = extractJson(await result.text);
          } catch {
            streamError ??= err;
          }
          if (raw === undefined) streamError ??= err;
        }
        const validated = raw === undefined ? null : validate(raw);
        if (validated) {
          await done(validated.value, "model", null);
        } else {
          const reason = streamError ? failureReason(streamError) : "invalid_output";
          await done(fallback(), "fallback", reason, streamError instanceof Error ? streamError.message : undefined);
        }
      } catch (err) {
        console.error("[artifact/generate] save failed:", err); // never break the stream on a save problem
      }
    },
  });

  return createTextStreamResponse({ stream: toTextStream({ stream: result.stream }).pipeThrough(saveBeforeClose) });
}
