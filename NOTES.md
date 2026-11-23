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
- **Session id lives in a React context, not a module variable.** My first `page.tsx` kept the id in
  `useState` plus a module-level `currentSessionId` that the chat transport read (a workaround for the
  `react-hooks/refs` lint rule). Overrode that: `SessionProvider` (`components/session-provider.tsx`, mounted in
  `layout.tsx`) owns the localStorage/`POST /api/sessions` logic, and any client component calls `useSession()`
  for `{ sessionId, error, retry }`. The chat sends it per call (`sendMessage(msg, { body: { sessionId } })`),
  so the transport is a plain module constant with no stale closure. Later steps (goals, page generation,
  publishing) reuse the same hook. Server side is unchanged: tools get the id from `buildTools(sessionId)`.
- **Playwright over a manual checklist.** Two projects: `mocked` (intercepts `/api/chat` with a hand-built UI
  message stream; 8 tests, ~8 s, no LLM calls) and `live` (real model + Firecrawl + Supabase, 30 s pause between
  tests for the free model's 5 requests/min). `E2E_BASE_URL` points the same tests at the deployed URL.
  The mocked suite also proved the per-call `{ body: { sessionId } }` reaches `/api/chat` (on submit and Retry).
- **Caught by tests, not by me:** Next.js adds its own hidden `role="alert"` route announcer, so an unscoped
  `getByRole("alert")` matched two elements; scoped it to the Conversation region.
- **Transcript export:** `/export` can only be run by the user, so I generated a cleaned export of the Claude Code
  session from its log (tool outputs dropped, secrets and email redacted, verified against `.env.local`).
- **Added a "Use a different website" link (human's call).** After research there was no way back to step 1 short of
  a refresh. Added a link that stops any in-flight request, clears the chat and returns to the form, keeping the same
  session (a new lookup upserts over the saved profile). It is outside the M1 spec; asked first, then built.
- **Finish and deploy Milestone 1 before starting Milestone 2 (human's call).** Rather than add a placeholder
  "Continue" button that does nothing, M1 was closed out first: local checks, deploy, then the same tests on the
  deployed URL.
- **Milestone 2 spec delegated to a separate agent** with a self-contained brief (read-only except for `SPEC-M2.md`,
  no servers or tests, unknowns go under "Open questions for the human"). It found real M1 gaps that M2 fixes:
  the no-website description is never saved, researching a second site leaves stale goals, and `SessionProvider`
  never checks that a stored session id still exists.
- **Human overrode the agent's route names.** The M2 spec had `POST /api/goals` (generate suggestions) and
  `POST /api/goal` (save the choice), one letter apart and easy to mix up. Renamed to `POST /api/goals/suggest`
  and `POST /api/goals/choose`.
- **Human overrode the number of suggested goals: at least 4, not 2-4.** There are exactly four goal types, so the
  user always sees all four, one per type, most relevant first.
- **Human approved filling missing goals from defaults.** If the free model returns fewer than 4 distinct types, the
  server fills the gaps from `DEFAULT_GOALS` and tags those goals `source: "default"`, so there are always 4 cards.
  This is why the tool's Zod schema is `min(1).max(4)` (not `min(4)`): a strict `min(4)` would fail validation on a
  3-goal answer and throw away a good category and summary before the fill step could run. Only zero usable model
  goals returns `invalid_output`. Default-filled cards look the same as model cards (agent's default, not yet
  explicitly confirmed by the human).
- **Going back stays a server call (`POST /api/step/back`); human agreed.** Considered a client-only back. Rejected
  because the step lives in `sessions.status`, so a screen-only back would jump forward again on refresh, and because
  going back must clean up: `building -> goal` clears the saved goal (keeps suggestions, so no new model call);
  `goal -> site` also clears `category`, `summary` and `suggested_goals` so a new website never shows the old site's
  goals. If the call fails, the screen is left alone so it never disagrees with the database. Cost: one round trip.
- **Describing a business replaces the whole profile row; human confirmed wiping old brand data.** The planned
  `POST /api/profile/describe` (saves the one-sentence description from the no-website path, which M1 never
  persisted) overwrites `business_profiles` for the session: `url`, `name` and `brand` emptied, `content` becomes
  `{ description }`, `field_sources: { description: "user" }`, and `category`/`summary`/`suggested_goals` cleared. So
  a user who researched a site, went back and described a business instead never keeps the old site's brand.
- **M2 step 3 (page split): Continue button, not auto-advance.** `researchSite` moves the server status to `goal`
  before the user has read the brand card, so the shell never switches steps on its own: `SiteStep` shows
  **Continue** once the chat turn is done and the server has what it needs (research ok, or the description saved),
  and Continue just asks the shell to re-read `sessions.status`.
- **Caught while testing step 3:** in the no-website path the description box stayed on screen after submitting, so
  there were two "Continue" buttons (the box's own submit and the real one) and my test's wait returned early.
  Fixed by hiding the box once the description is saved.
- **"Use a different website" is now server-first:** it calls `POST /api/step/back`, and only resets the screen if
  that succeeds (otherwise an inline alert, local state untouched). Known edge: if the user leaves while
  `researchSite` is still running on the server, the tool can still advance the status to `goal` after the back call.
- `GoalStep` and `NextUpStep` are placeholders (with a working back link) until the next build steps.
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

### UI + e2e test results (2026-11-23, local)
- Mocked suite (`npm run test:e2e`): **8/8 pass**. Step 1 render, AC-5 (one session, reused on refresh),
  AC-6/7/8 (Reading within 1 s, brand card, summary), failed-research fallback, AC-14 UI path, rate-limit
  message + Retry, network failure + Retry, session failure + retry.
- Live suite (`npm run test:e2e:live`): **6/6 pass** in 3.6 min. `starterbakery.com` end to end incl. Supabase
  rows and events (AC-5..10), `cal.com` (AC-11), unreachable domain + `tool_failed` (AC-12), `localhost:3000`
  and `ftp://` as `invalid_url` with no `research_done` (AC-13), no-website path (AC-14).
- Still open: AC-15 (missing Firecrawl key), AC-2/3/4 (deploy, bundle secret scan, `assets` bucket), and
  re-running the live suite against the Vercel URL.
- Known gap: `ProgressSteps` is hardcoded to step 0 and `page.tsx` has no step state; the sessions `status`
  column is the natural source once Milestone 2 adds the goal step.

### Milestone 1 on production (2026-11-23): https://ploy-ftu-pn3w.vercel.app
- Live suite (`E2E_BASE_URL=... npm run test:e2e:live`): **6/6 pass** (3.6 min), same assertions as local. They read the
  rows back from Supabase, so this also confirms Vercel uses the same Supabase project as `.env.local`.
- Mocked suite against the deployed page: **9/9 pass**.
- AC-2: `/` loads with **0 console errors** (headless Chrome).
- AC-3: none of the 4 secret values appear in the 8 responses the browser loads on production (HTML, JS, JSON);
  also none in the local `.next/static`; no `NEXT_PUBLIC_*` variables used.
- AC-4: all 5 tables readable with the service role; `assets` bucket exists and is private. RLS-enabled is per the
  migration, not independently verified (needs the anon key).
- AC-15: ran a production build (`next start`, port 3100) with `FIRECRAWL_API_KEY=""`: tool returned
  `{ ok:false, reason:"unknown" }`, no 500, `tool_failed` logged with "FIRECRAWL_API_KEY missing".
  (A second `next dev` in the same directory is refused by Next.js, so I used `next start`.)
- Manual testing on the deployed URL by the human: works as expected.
- Status: all Milestone 1 acceptance criteria verified except AC-16 (explainability, for the human to answer live).

