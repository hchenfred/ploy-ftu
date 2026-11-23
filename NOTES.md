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
- **Supabase grants:** `permission denied for table sessions` even with the service key. Tables made via the
  SQL editor had no `service_role` privileges (it bypasses RLS, not GRANTs). Added grants to `0001_init.sql`.
- **AI Gateway needs a card on file, and the free tier can't use `anthropic/claude-sonnet-5.5`.** Switched
  `MODEL_ID` to the free `nvidia/nemotron-3.5-lightning-free`. Caveat: tool-calling reliability varies by
  model, so watch whether `researchSite` is called correctly (and exactly once). Swap back to a paid model
  once credits are added; no code change needed. The free model is also capped at **5 requests/min** per team
  (one onboarding run is ~2), so test one request at a time, or the stream errors out with a 429.
- **Rate-limit error is now explicit.** The SDK's default stream error is a generic "An error occurred."
  `/api/chat` passes `onError` to `toUIMessageStream`: it logs the real error and, for a 429 (walking the
  `AI_RetryError` cause chain), sends "Rate limit reached: the free-tier AI model allows only about 5 requests
  per minute. Wait a minute, then retry." The SDK retries 3 times first, so a 429 often just shows up as a
  slow (35-56 s) request, and the message only appears when retries are exhausted.
- (add yours here)

### Backend test results (2026-11-23, local, via curl; no UI yet)
Model: free `nvidia/nemotron-3.5-lightning-free`.

| AC | Result | Notes |
| --- | --- | --- |
| AC-1 | Pass | `npm run lint` and `npm run build`: zero errors |
| AC-5 | Partial | Session row and `ftu_started` event created; reuse-on-refresh needs the UI |
| AC-7 | Partial | `starterbakery.com` returned name, 4 colors, fonts, logo in ~5 s; the card needs the UI |
| AC-8 | Pass | One-sentence summary streams after the tool result |
| AC-9 | Pass | `business_profiles` row has `url`, `brand`, `field_sources` |
| AC-10 | Pass | `research_done` has `ok: true` and `ms` |
| AC-11 | Partial | `cal.com` returned a brand and summary; the card needs the UI |
| AC-13 | Partial | `localhost:3000` gave `invalid_url` + `tool_failed`; `ftp://` not tested yet |
| AC-14 | Pass | "A bakery in Oakland..." got one sentence, no tool call |
| Not tested | | AC-2/3/6 (UI, deploy), AC-4 (`assets` bucket not verified), AC-12, AC-15 |
