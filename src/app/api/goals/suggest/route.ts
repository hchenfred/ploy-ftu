import { generateText, InvalidToolInputError, isStepCount, NoSuchToolError } from "ai";
import { z } from "zod";
import { buildGoalTools } from "@/lib/agent";
import { isRateLimitError, isTimeoutError } from "@/lib/ai-errors";
import { GOALS_MODEL_TIMEOUT_MS } from "@/lib/artifact/limits";
import { logEvent } from "@/lib/events";
import type { SuggestGoalsReason, SuggestGoalsResponse } from "@/lib/goals";
import { GOALS_PROMPT } from "@/lib/prompts";
import { loadSessionState } from "@/lib/session-state";
import { buildGoalsInput, type SuggestGoalsOutput } from "@/lib/tools/suggest-goals";

// Must be a literal for Next and equal GOALS_ROUTE_MAX_DURATION_SECONDS (a unit test checks).
export const maxDuration = 40;

const Body = z.object({ sessionId: z.uuid() });

type Reason = SuggestGoalsReason;
type SuggestResponse = SuggestGoalsResponse;

// POST /api/goals/suggest: ask the model for goal suggestions for this session's business.
// Why a route and not the /api/onboarding agent loop: there is no conversation, the step is deterministic, and
// the free model's tool choice is unreliable. A forced tool choice removes "did it call the tool at all",
// and a plain JSON response keeps the client simple (no useChat).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not load the session" }, { status: 500 });
  }
  if (current.state.status !== "goal") return Response.json({ error: "wrong_step" }, { status: 409 });

  // Suggestions already saved (refresh, or back and forward): reuse them, no model request.
  const saved = current.state.profile?.suggestedGoals;
  if (saved && saved.length > 0) {
    const body: SuggestResponse = {
      ok: true,
      source: "saved",
      summary: current.state.profile?.summary ?? "",
      goals: saved,
    };
    return Response.json(body);
  }

  const started = Date.now();
  // Failure after the guards is still HTTP 200 with { ok: false }: the UI falls back to default goals.
  const failed = async (reason: Reason, toolAlreadyLogged: boolean, detail?: string) => {
    await logEvent(sessionId, "goals_suggested", { ok: false, reason, ms: Date.now() - started });
    if (!toolAlreadyLogged) await logEvent(sessionId, "tool_failed", { tool: "suggestGoals", reason, detail });
    return Response.json({ ok: false, reason } satisfies SuggestResponse);
  };

  let prompt: string | null;
  try {
    prompt = await buildGoalsInput(sessionId);
  } catch (err) {
    return failed("unknown", false, err instanceof Error ? err.message : String(err));
  }
  if (!prompt) return failed("no_profile", false); // nothing to base suggestions on: don't spend a request

  try {
    const result = await generateText({
      model: process.env.MODEL_ID ?? "anthropic/claude-sonnet-5.5", // via Vercel AI Gateway
      system: GOALS_PROMPT,
      prompt,
      tools: buildGoalTools(sessionId),
      toolChoice: { type: "tool", toolName: "suggestGoals" }, // the model must answer through the tool
      stopWhen: isStepCount(1), // the tool result needs no follow-up text
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(GOALS_MODEL_TIMEOUT_MS),
    });

    const output = result.toolResults.find((r) => r.toolName === "suggestGoals")?.output as
      | SuggestGoalsOutput
      | undefined;
    if (!output) return failed("invalid_output", false, "model did not call suggestGoals");
    if (!output.ok) return failed(output.reason, true); // the tool already logged tool_failed

    await logEvent(sessionId, "goals_suggested", {
      ok: true,
      source: "model",
      ms: Date.now() - started,
      filled: output.filled,
    });
    const body: SuggestResponse = {
      ok: true,
      source: "model",
      summary: output.summary,
      goals: output.goals,
    };
    return Response.json(body);
  } catch (err) {
    console.error("[goals/suggest] model call failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    if (isRateLimitError(err)) return failed("rate_limited", false, detail);
    if (isTimeoutError(err)) return failed("timeout", false, detail);
    if (InvalidToolInputError.isInstance(err) || NoSuchToolError.isInstance(err)) {
      return failed("invalid_output", false, detail);
    }
    return failed("unknown", false, detail);
  }
}
