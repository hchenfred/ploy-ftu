import "server-only";
import type { InferUITools, UIMessage } from "ai";
import { researchSiteTool } from "@/lib/tools/research-site";

// The agent's tool set for one session. Milestone 1 has a single tool.
export function buildTools(sessionId: string) {
  return {
    researchSite: researchSiteTool(sessionId),
  };
}

// Message type shared with the client, so `part.type === "tool-researchSite"`
// and its `output` are fully typed in the UI. (Type-only imports are erased,
// so the client never loads this server-only module.)
export type FtuTools = InferUITools<ReturnType<typeof buildTools>>;
export type FtuUIMessage = UIMessage<never, never, FtuTools>;
