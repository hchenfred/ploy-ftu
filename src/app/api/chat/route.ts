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
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
