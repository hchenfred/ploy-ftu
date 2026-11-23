import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { buildTools } from "@/lib/agent";
import { SYSTEM_PROMPT } from "@/lib/prompts";

// Scraping + a model reply can take ~40 s; allow up to 60 s on Vercel.
export const maxDuration = 60;

const BodySchema = z.object({
  sessionId: z.uuid(),
  messages: z.array(z.custom<UIMessage>()).min(1),
});

// Message shown in the UI when the model provider rate-limits us. The default
// model is a free-tier one capped at ~5 requests/min, so this is the most likely
// failure in development.
const RATE_LIMIT_MESSAGE =
  "Rate limit reached: the free-tier AI model allows only about 5 requests per minute. Wait a minute, then retry.";

function isRateLimitError(error: unknown): boolean {
  // Walk the cause chain: the SDK wraps the gateway's 429 in a retry error.
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const err = e as { statusCode?: number; message?: string; cause?: unknown; lastError?: unknown };
    if (err.statusCode === 429 || /rate.?limit/i.test(err.message ?? "")) return true;
    e = err.lastError ?? err.cause;
  }
  return false;
}

// POST /api/chat: the onboarding agent. Streams text and tool parts to useChat.
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sessionId, messages } = parsed.data;

  const result = streamText({
    model: process.env.MODEL_ID ?? "anthropic/claude-sonnet-5.5", // via Vercel AI Gateway
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools(sessionId),
    stopWhen: isStepCount(4), // cap the agent loop: tool call -> result -> reply
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      // The default error text is a generic "An error occurred." Log the real error
      // server-side and send the client a message it can act on.
      onError: (error) => {
        console.error("[chat] stream error:", error);
        return isRateLimitError(error) ? RATE_LIMIT_MESSAGE : "Something went wrong. Please try again.";
      },
    }),
  });
}
