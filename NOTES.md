# Build notes

Running log of decisions, places where I overrode the coding agent, and problems I solved myself.
(Material for the "how I built it" half of the Loom.)

**Transcripts:** see `transcripts/README.md`. Main session: Claude desktop app chat (research → design → system design → SPEC → Milestone 1 build).

## Milestone 1: Foundation + "Your site"

### Decisions
- **AI Elements via shadcn components.** AI Elements has moved into shadcn/ui as copy-in patterns
  (no package). Installed `message` etc. with `npx shadcn@latest add …`, chose Base UI + Nova preset.
- **AI SDK v7 APIs, checked against `node_modules/ai/docs`:** responses use
  `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`;
  the step cap is `isStepCount(n)` (older examples use `stepCountIs` / `toUIMessageStreamResponse`).
- **Tools are built per request** (`buildTools(sessionId)`), so the tool gets the session id from the
  server, never from the model. The LLM only supplies the URL.
- **Tools never throw.** `researchSite` returns `{ ok: false, reason }`; the prompt tells the agent to ask
  for a one-sentence description instead. No dead ends.
- **Events are written by server code**, not the LLM (`lib/events.ts`).
- **Full schema up front** (`supabase/migrations/0001_init.sql`), RLS on with no policies:
  only the server's service role key can read/write.
- **URL guard** in `lib/url.ts` blocks non-http(s), localhost and private IPs before calling Firecrawl.
- npm registry is blocked in the agent's sandbox, so I ran installs in my own Terminal.

### Overrides / things I figured out
- (add yours here)
