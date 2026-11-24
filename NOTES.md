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
- **Removed `category` from the goals call (human's call).** Nothing reads `business_profiles.category` before the
  Milestone 3 image prompt, and it was one more field the free model got wrong (it came back cut off mid-word:
  "neighborhood bakery with two San Francis"). `suggestGoals` now writes only `summary` and `suggested_goals`;
  every other reference (reads, clears, response shapes, the spec) is gone. The column stays in the table, unused.
  Also noted: category was never set in step 1 because that would cost an extra model request per lookup on a
  5 requests/min model (the step 1 reply is chat text and is not saved).

### Deferred, to deal with later
- **SPEC-M3 still builds its fal image prompt from `profile.category`.** That field is no longer filled. Decide in M3
  where the image hint comes from: derive it from `summary`, have the page-composition call produce it, or add
  `category` back to the goals call (with a short "2 to 4 words" description).
- ~~Hard length limits on model-written text cut labels mid-phrase~~ **Fixed (human's call).** Live labels like
  "...inquiries from cafes and" (54-55 chars, under the 60 limit) showed the model squeezes text to fit a schema
  `max()`. Removed the `max()` from the model-facing schema (summary/label/reason), asked for "short, complete" text
  in the field descriptions and `GOALS_PROMPT`, and enforce the limits on the server with `clip()` (word boundary,
  never ends on a dangling and/for/to). Verified: unit tests for `clip` + 3 live calls on different businesses, 12
  of 12 labels and reasons complete (30-43 chars). Deviates from the spec's original schema; SPEC-M2 updated.
- **Goal-step quality on the free model is best effort**: expect default-filled goals and the fallback to appear.
- **M2 step 5 (choose + goal screen):** `POST /api/goals/choose` looks the label up on the server (the browser
  sends only a goal type or custom text, and a stray `label` field is ignored), rejects a type we did not offer
  (400) and any call outside the `goal` step (409), and the goal columns are written with `where status = 'goal'`
  so a stale tab cannot overwrite a saved goal. `GoalStep` shares one in-flight suggestions request per session
  (Strict Mode would otherwise spend two model requests) and falls back to the four default goals on any failure,
  with a "Try again". Cards are a keyboard-friendly radiogroup (arrows move and select, Enter submits).
  Known edge: after taking the fallback defaults nothing was saved, so "Change my goal" asks the model again.
- **M3 image generation: the reference product photo is scraped from the user's site; no upload in the MVP (human's
  call, changed once).** The brief's requirement (pick a fal model that takes a product photo as a reference and
  renders text well; copy outputs into Supabase Storage because fal URLs are not durable) is about **ad images for
  the `paid_growth` goal**: an image model has never seen the user's real product, so it invents one; with a
  reference photo it keeps the real product and changes only the scene and the headline. First chose "user upload
  only", then switched to **scrape first**: `researchSite` collects the site's product images (the installed
  Firecrawl 4.54.0 can return `images`, `branding.images.ogImage` and a `product` format), the best one is the
  reference. **If no usable image is found, show a text-only branded ad card (our own component, brand colors,
  name and headline), not a generated image.** **Upload is listed as "next"**, not built. Trade-off accepted:
  faster to build, but users without product images on their site (and everyone on the no-website path) never see
  the fal feature. **Later iteration (planned): "scrape first, upload as fallback"**, which covers every case
  (an estimated 30-45 minutes of work for the upload, to be built in the milestone that does the `paid_growth` ad
  properly). This overturns SPEC-M3's defaults ("one hero image, no uploads", "no `ad_creative`") and its
  text-to-image default model (`flux/schnell` neither takes a reference image nor renders text well). SPEC-M3 needs
  to be rewritten for it.
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

## Milestone 2 on production (2026-11-23): https://ploy-ftu-pn3w.vercel.app

Everything below was run against the deployed URL (`E2E_BASE_URL`), after pushing `909b428`.

| Run | Result |
| --- | --- |
| Mocked suite (`npm run test:e2e`) | **32/32 pass** (23 new goal-step tests + the 9 from M1) |
| M2 live suite (`goals.live.spec.ts`) | **9/9 pass** (2.7 min; 6 tests spend no model request, 3 use the real model + Firecrawl) |
| M1 live regression (`onboarding.live.spec.ts`) | **6/6 pass** (3.6 min) |
| Page console errors on `/` | **0** (headless Chrome) |
| Secret values in the 9 responses the browser loads | **none** of the 4 found |
| New routes deployed | bad-input probes return 400/404/400/400/400 |
| Manual testing by the human on the deployment | works as expected |

### Acceptance criteria
| AC | Status | How |
| --- | --- | --- |
| AC-17 | Pass | `npm run lint` + `npm run build` zero errors; M1 mocked suite unchanged and green |
| AC-18 | Pass | Both constraints reject invalid rows (Postgres error 23514) and accept valid ones. Written as drop-if-exists + add, so re-running is safe **by construction; I did not run it twice** |
| AC-19 | Pass | No secrets in `.next/static` or the production responses; `goals.ts` has only a type-only server import; `use-session-state.ts` imports nothing server-side; routes use `supabase-server.ts` (`server-only`) |
| AC-20 | Pass | Mocked (3 statuses + refresh) and live (refresh at goal and building) |
| AC-21 | Pass | Mocked stale-id test; live 400/404 and no `digest` in the state |
| AC-22 | Pass | Live full run: status `goal` and `step_changed` set by the server while the page waits on Continue |
| AC-23 | Pass | Live: description saved, `url` null, status `goal`, `description_saved` event |
| AC-24 | Verified by script, not in a suite | In step 2 a seeded stale profile had `suggested_goals`/`summary` cleared by a fresh research. Not part of the Playwright suites |
| AC-25 | Pass | Mocked: loading status within 1.5 s, then 4 cards + "Something else" |
| AC-26 | Pass | Live: 4 goals from the real model, saved with `summary`, `goals_suggested` has `ms` and `filled`, every goal has `source` (took ~5 s, so no fallback) |
| AC-27 | Pass | Mocked + live: zero suggest requests with saved suggestions, also after a refresh |
| AC-28 | Pass | Mocked (no label sent) + live (DB label is the stored one, `goal_chosen` logged) |
| AC-29 | Pass | Mocked + live (type null, label "Custom goal", trimmed text) |
| AC-30 | Pass | Mocked + live (end state, step 3, "Coming soon", no `artifacts` row) |
| AC-31 | Pass | Mocked + live (goal cleared, cards kept, zero suggest requests) |
| AC-32 | Pass (mocked) | All 5 failure reasons and a network error show the fallback with 4 default cards; a default card saves the server's label. **The 30 s client-side stall is not tested** (it would add 30 real seconds) |
| AC-33 | Pass (mocked) | "Try again" replaces the defaults with the suggestions |
| AC-34 | **Not verified end to end** | Unit-level only: `normalizeGoals` returns null for zero usable goals (which becomes `invalid_output`). I never forced the model to return invalid tool arguments or skip the tool. The agent that traced the code could not confirm whether SDK v7 throws or returns an invalid-tool-input error; either way the user gets `invalid_output` and the fallback |
| AC-34b | Pass | Unit tests (`normalizeGoals`, `clip`) + mocked UI (4 identical cards in stored order) |
| AC-35 | Pass | Live: 409 outside the step, 400 for a type that was not offered, nothing changed |
| AC-36 | Pass | Mocked (incl. failed back stays on step 2 with an alert) + live (DB cleared, `step_back` logged) |
| AC-37 | Pass | Mocked: failed research -> describe -> Continue -> step 2 |
| AC-38 | For the human | Explainability questions, answered on the Loom |

### Problems found while building M2 (see the decisions above for the fixes)
- Stale `next dev` module cache gave `buildGoalTools is not a function` after adding an export; restarting the dev server fixed it (not a code bug).
- `0002_goals.sql` as DO blocks failed to paste partially (`begin` read as a transaction); rewrote it as four plain statements.
- A second Continue button in the no-website path; goal labels cut mid-phrase by a schema `max()`; `category` was a field nothing read.

## Milestone 3: investigation and what to fix in the spec first
A read-only agent checked SPEC-M3.md against the code as it is now. Verdict: **not ready to implement as written**.
1. Replace `profile.category` (image prompt, fallback copy, compose input): it is never written now. Use `summary`.
2. The `composePage` model schema puts hard `max()` on every field, repeating the mistake fixed for goal labels
   (a violation sends the whole page to the fallback). Use short wording plus the server-side `clip()`.
3. `buildImagePrompt` is planned in the server-only `fal.ts`, which Playwright unit tests cannot import: move it
   into `src/lib/page/`.
4. `playwright.config.ts` starts `npm run dev` for every project, which conflicts with a "no web server" unit
   project; there is also no `test:unit` script yet.
5. Race in generation: two concurrent calls can orphan an image, and `step/back` during generation can leave a stale
   page. Reuse one artifact id per session and recheck `status` before writing.
6. `researchSite` uses `onlyMainContent`, so footer facts (phone, hours) are often missing; markdown escapes can
   break verbatim matching. The describe path never gets any.
7. Update the M2 assertions M3 breaks: `goals.mocked.spec.ts` ("Coming soon" / no artifacts) and `goals.live.spec.ts`.
**Human setup for M3:** create a fal.ai account and key, add `FAL_KEY` (and optionally `FAL_MODEL_ID`) to
`.env.local` and Vercel, apply `0003` by hand in the SQL editor. Verify fal's request/response shape with one real
call before writing the client (it is not in the repo).

## fal.ai model research for the M3B ad image (2026-11-23, from public docs; no API call made)
Need: a model that takes a **reference product photo** and renders **text** well. Shortlist (all three accept multiple
reference images): `google/nano-banana-2.1/edit` (primary: ~$0.04-0.06/image, typography tags, newest so least track
record), `fal-ai/nano-banana-2/edit` (stable fallback, $0.08 at 1K), `openai/gpt-image-2.5/flare/edit` (reviews say the
GPT image models render text best; set `quality: "medium"`, latency unknown). `flux-pro/kontext` is weakest on text.
- **API shape (from fal's docs):** `Authorization: Key $FAL_KEY`; queue host `https://queue.fal.run/<endpoint id>`
  (submit, poll `status_url`, GET `response_url`; retries 503/504) vs sync `https://fal.run/...` (no retry). Use the
  queue from a 60 s function and give up at ~45 s. Request: `prompt`, `image_urls`, `num_images`, `aspect_ratio`,
  `resolution`, `output_format`, `safety_tolerance`. Response: `images[{url, content_type, width, height}]`.
  A Supabase signed URL should work as the reference image (fal fetches it, so give it a few minutes of life).
- **Plain `fetch` is enough**, so no `@fal-ai/client` dependency.
- **"fal URLs are not durable" is only half true:** outputs live at least 7 days by default (configurable), then are
  deleted; copying into Supabase Storage is still the right call (queue results are kept only 1 hour).
- **Gotchas:** new accounts start at 2 concurrent requests (sync over the cap returns 429); prepaid credits, requests
  rejected below a lock threshold; Nano Banana has no 1.91:1 ratio (use 1:1 or 16:9 and crop); no source guarantees
  spelling, so check the headline in a test; text already on the product may be altered.
- **Evidence is weak:** text quality and product fidelity rest on reviews and vendor tests, not fal's pages.
- **One real test call must check:** latency, real cost, product recognizable and headline spelled right in 5+ runs,
  that a Supabase signed URL is accepted, how a safety refusal is reported, the output URL expiry, and that
  `nano-banana-2.1` is stable enough (else use `nano-banana-2`).

## MVP goals and how they connect to Ploy's primitives (decided 2026-11-23) [SUPERSEDED the same day: see "MVP re-scope" below]
The take-home brief: build an AI-native FTU that connects users to value and converts them to paying customers, across
Ploy's primitives (PloyDB, Ploybooks, sites/domains/publishing, brand guidelines, integrations, ads, analytics), and
that can iterate and evolve from usage data, feedback and changing goals. Primitives as described by the human:
**PloyDB** = built-in spreadsheet-style relational database (typed fields, lead capture, live template binding,
scoped keys: public read-only vs form submissions write-only, secret columns hidden from AI agents, CSV import,
30-day restore, CLI). **Ploybooks** = saved multi-step AI agent workflows, on demand or scheduled, with a library of
pre-built ones (ship a homepage section by section, SEO guides, site audits...), able to act across the site and
integrations (draft replies to contact forms, post weekly analytics to Slack).

**Decisions (human approved all four):**
1. **MVP fully supports two goals: `inbound_leads` and `paid_growth`.** The other two (`local_customers`,
   `capture_and_follow_up`) are still shown (the human wants at least 4 options) but marked **coming soon**; clicking
   one logs a `goal_interest` event and the user picks an available goal. That turns the missing goals into usage data
   for the roadmap. Why these two: they exercise most of the brief (sites + publishing, ads, a PloyDB-style leads
   table, analytics, brand); `local_customers` needs facts the scraper often misses, `capture_and_follow_up` needs
   follow-up (Ploybooks, email) we are not building. Defaults I chose, not yet explicitly confirmed: the model still
   ranks all four; "Something else" (custom goal) counts as interest and asks the user to pick an available goal.
2. **Each goal is linked to primitives, in our own data, not by the model** (a goal catalog in `goals.ts`: available,
   primary primitive, supporting, next). Shown as a tag on each goal card ("Uses: Sites · PloyDB") and logged on
   `goal_chosen`.

| Goal | First win | Supporting | Next (conversion hook) |
| --- | --- | --- | --- |
| inbound_leads | Sites: published page with a lead form | PloyDB (Leads table), Brand, Analytics | Ploybooks: draft a reply to each new lead |
| paid_growth | Ads: the ad creative | Sites, Brand, Analytics | Integrations (connect an ad account), then a Ploybook weekly summary |
| local_customers (soon) | Sites | Brand, Analytics | Integrations (e.g. a business listing) |
| capture_and_follow_up (soon) | PloyDB | Sites | Ploybooks (a follow-up could be a draft shown to the owner, no email needed), Integrations |

3. **M4 frames form submissions as a PloyDB "Leads" table** (typed fields, a `status` such as new/contacted,
   write-only public access, owner read) and shows the owner a **spreadsheet-style leads view** with the status
   column, so the user actually meets the primitive in the MVP.
4. **The build screen names the generation steps as a playbook** (read your site, choose the layout, write the copy,
   check the page): a wording and progress change only, no real Ploybooks feature.
5. **The "you're live" screen uses the goal's `next` primitive as the call to action.** This is the conversion
   moment the plan was missing (the brief asks to convert users into paying customers).

**Not covered by the MVP (to say plainly in the write-up):** PloyDB as a real product (we have a stand-in table),
Ploybooks (named steps only), integrations, custom domains, and any paywall or pricing. **How it evolves:** every
step is already an event with props; suggestions carry `source`; profile fields carry provenance; goal-to-page
mapping is data; the "coming soon" clicks and the `next` CTA are the usage signals for what to build next.

**Follow-up decisions (human: "yes to all, let's try that first, we can iterate later"):**
- **Test lead after publishing (`inbound_leads`).** Neither goal delivers value without traffic, so the owner gets a
  "Send a test lead" button that writes a clearly labeled test lead (fixed fake content, `is_test = true`, max 3 per
  page, `test_lead_sent` event) into the Leads table at once, so PloyDB is visible in the first session. Test leads show
  a "Test" badge and are excluded from metrics and the verdict sentence.
- **Goal cards show primary + one differentiating primitive** (`cardTags` in the catalog: inbound_leads Sites+PloyDB,
  paid_growth Ads+Sites, local_customers Sites, capture_and_follow_up PloyDB+Ploybooks). Brand and Analytics are "always
  on", said once under the cards ("Every goal includes your brand and analytics.").
- **`paid_growth`'s deliverable is the creative itself:** the UI says plainly the ad has not been published or run
  anywhere (no ad account connected) and offers "Copy ad text" (no image download in the MVP).
- **Confirmed defaults:** the suggest model still ranks all four goals; "Something else" counts as interest
  (`goal_interest`, custom) and asks the user to pick an available goal.
- Known weak spots to revisit (from the goal review): ads cannot actually be run until the Integrations step;
  `inbound_leads` and `capture_and_follow_up` are close until follow-up exists; free-text goals never work in the MVP;
  a model-written label could promise something the card tags do not match (worth a test).

## MVP re-scope: three goals, one artifact each, no publishing (decided 2026-11-23, supersedes the section above)
The human asked to step back: the plan (four goals, a goal catalog with coming-soon cards, publishing, a public page,
a leads table, a test lead, metrics) had become more complicated than an MVP needs. Adopted instead a suggestion:
**one onboarding flow with three starting goals; the user enters a URL, the agent researches it and shows what it
found to confirm, the user picks a goal, and one useful artifact is generated with a streamed preview that they can
save; then a hand-off to the Ploy primitive where it lives.** If research fails or there is no website, ask for a
short description (already built).

| Goal (persona) | goal_type | First artifact (saved) | Where Ploy takes them next |
| --- | --- | --- | --- |
| Launch a product (ecommerce founder) | `launch_product` | Branded ad creative from an **uploaded product photo** (text-only branded card if no photo or fal fails) | Ads |
| Get leads for my service (local service owner) | `get_leads` | Landing-page **preview** with a quote-request call to action (not published) | Sites and publishing |
| Plan a marketing campaign (small marketing team) | `plan_campaign` | **Saved campaign playbook** with tasks and a success metric | Ploybooks and analytics |

**Decisions (human, all "yes"):**
1. Adopt the three-goal, one-artifact plan; **publishing is "next"** (not MVP).
2. **Ad photo: upload now** (reverses "scrape first, upload later": with publishing gone, upload is simpler and safer
   than the SSRF-guarded download of scraped images, and it works for users with no website).
3. **Replace the four goal types with the three** (needs a migration; old M2 test goal rows are reset).
4. **Option A for picking:** the user picks among the three goal cards, and the model marks one **"Recommended"** and
   pre-selects it (no goal is chosen for them). Log recommended vs chosen: how often the model is right is a usage
   signal for iterating. Option B (the model decides, the user confirms) was rejected: a wrong guess sends the user
   to the wrong artifact, and the free model is unreliable at it.
5. **Activation metric = time from onboarding start to first artifact saved** (`ftu_started` to `artifact_saved`,
   from events we already write); **paid conversion is tracked separately** as a click on the hand-off. Record the
   selected goal and tool failures (already logged) to explain where users got stuck.
6. **A streamed preview is in** (reverses the earlier "no streaming"): the playbook and the page stream as a partial
   structured object (`streamText` + `Output.object`, `useObject`); the ad shows named progress steps.

**Removed from the MVP (kept as notes for later):** the goal catalog with availability, "coming soon" cards and
`goal_interest`; the "Something else" custom goal; primitive tags beyond one line; the leads table (PloyDB view),
test lead, `/metrics`, `/p/[slug]`, form submissions; the scrape-first ad photo with its SSRF-guarded download. The
earlier drafts moved to `docs/next/` (`publish-and-measure.md`, `ad-creative-scrape-version.md`) with a banner.
New spec: **`SPEC-M3.md`** (rewritten in place).

**Follow-up decisions on SPEC-M3 (human review, 2026-11-23):**
- Photo downsized in the browser (also strips EXIF location), type checked by magic bytes on the server: **good as written**.
- The ad never invents an offer; the headline is the user's text or the business name; the ad needs no model call, only
  fal: **good as written**.
- After saving there is no "change my goal"; "Start over" begins a new session: **keep for now, to be discussed later**.
- Streaming from the server (server validates, clips and saves; the row exists before the stream closes) and the cap of
  3 generations per session (about $0.24 worst case with fal): not objected to, treated as accepted.
- **Hand-off is a real link per primitive, using fake placeholder URLs for now** (`https://example.com/ploy/ads`,
  `/sites`, `/ploybooks`), kept in the goal catalog so they are a one-table swap. The click logs `handoff_clicked`
  first (keepalive fetch, never blocks the navigation); it opens in a new tab with `rel="noopener noreferrer"`.
  This replaces the earlier "Coming soon" button.

**Photo upload goes through our server (decision to keep; the trade-off is to be discussed in review):**
- **What the spec does:** the browser downsizes the photo (longest side 1,600 px, JPEG 0.85, which also strips EXIF
  location), then sends it to `POST /api/uploads/photo` as multipart. The server checks the real type by magic bytes and
  the size (max 4 MB) and stores it in the private `assets` bucket with the service key. The only presigned URL in the
  flow is the short-lived signed *read* URL of our stored copy that we give to fal.
- **Why through the server (not a presigned direct upload):** (1) we validate before anything is stored, whereas a
  direct upload lands the file first and can only be checked afterwards and deleted; (2) I was not certain of the exact
  mechanics of Supabase signed upload URLs (raw PUT vs multipart form) and would have had to test it first; (3) no
  browser key is needed, and the app deliberately has none.
- **What it costs:** a Vercel serverless function accepts only a limited request body (I believe about 4.5 MB; I have
  not checked the current figure), so the browser must downsize and the server cap is 4 MB; browsers cannot always
  decode iPhone HEIC, so those get a "choose a JPEG, PNG or WebP photo" message; image processing happens in the browser.
- **Alternative for a later iteration:** a signed direct upload to Supabase Storage allows large originals and keeps
  the bytes off our function, at the price of validating after upload and handling cleanup of rejected files.

## Milestone 3, step 1 (three goals) built and verified locally (2026-11-23)
- Done: `0003_artifacts.sql` (applied by the human; verified through the API: new goal types accepted, old ones
  rejected with 23514, `playbook` artifact type accepted, `saved_at` exists, a second artifact per session rejected with
  23505, no old goal data left); `goals.ts` with three goals, a hand-off catalog (placeholder `example.com` links) and
  `recommendedGoal()`; new `GOALS_PROMPT`; `choose` route takes only the three goals and logs `recommended` / `followed`;
  `GoalStep` with three cards, a "Recommended" badge and a pre-selected recommendation, "Next in Ploy: X" on each card;
  `npm run test:unit` (Node's runner, 9 tests) plus `allowImportingTsExtensions` in tsconfig so unit tests can import
  `.ts` files directly.
- Tests: mocked 35/35 (26 goal-step + 9 M1), unit 9/9, lint and production build clean.
- A live test failed once on a stale number (it still expected 4 saved suggestions); fixed, not an app bug.
- **Deploy order matters:** the database is migrated before the new code ships, so production's old four-goal step is
  degraded until the new code is deployed (the old choose route is rejected by the new constraint). Pushing right
  after local verification keeps that window short.
- **Step 1 live results (local server, real database and model):** 9/9 pass after fixing three stale numbers in my own
  tests (one still expected 4 saved suggestions, two still expected 5 cards; a search-and-replace had missed
  `toHaveCount(5, { timeout })`). The model returned three complete goals for the bakery with nothing filled from
  defaults. Pushed as `f336a7f` + `001d07b`.
- **On production:** probes show the new code is live (`choose` rejects the old `paid_growth` type with 400, accepts
  `get_leads`, rejects the removed custom kind with 400); mocked suite 35/35 against the deployed URL. The deployed live
  goal suite has not been run yet. There was a short window where the database was migrated before the new code
  shipped (the old four-goal step could not save a goal); no real users in that window.

## Milestone 3, step 2 (pure artifact modules) built (2026-11-23)
- Added `src/lib/artifact/`: `types.ts` (profile, `DeepPartial`, tolerant readers), `theme.ts` (hex parsing, WCAG contrast,
  `deriveTheme`), `playbook.ts` and `page.ts` (loose model-facing zod schemas, limits, `fallback*`, `validate*`), `ad.ts`
  (headline rule, fixed image prompt, `sniffImageType`). None import `server-only` or `@/`; they use explicit `.ts`
  imports so `node --test` can load them. A throwaway page importing them built in the production build, so the app's
  bundler accepts the explicit extensions.
- **Design change from the spec:** `validate*` fills missing parts from the deterministic fallback (per section) instead of
  failing the whole artifact, and returns `{ value, filled }`; `null` only when nothing usable came back. Playbook tasks:
  the prompt asks for 5 to 7, 3 to 7 are kept (a weak model that returns 3 or 4 is rescued, not rejected).
- 19 new unit tests (28 total, all pass): hex handling and contrast, headline never invented, image prompt carries only the
  headline and the accent, magic-byte detection (JPEG, PNG, WebP; GIF, SVG, RIFF-but-not-WebP, HEIC rejected), clipping at
  word boundaries, partial/garbage model output, hostile text kept as plain text, and a check that the model-facing schemas
  contain no `maxLength` / `maxItems` / `minLength` / `minItems`.
- I tightened one test of mine that could not fail (hostile text title): it now asserts the exact result.- **Hardening (human asked "what if the hex is invalid?"):** `buildImagePrompt` used to paste the accent into the prompt for the
  image model as given (`red`, an empty string or arbitrary text went straight through, and a long headline was not
  clipped there). It now validates both itself: the accent goes through the new `normalizeAccent` (valid 3 or 6 digit hex,
  else the ink color) and the headline is cleaned and clipped to 60. 30 unit tests pass. The accent normally comes from
  the scraped brand colors (hex-filtered in `researchSite`, then chosen by `deriveTheme`); the describe path has no brand
  so it is always the ink color.

## Milestone 3, step 3 (preview components) built (2026-11-23)
- Added `src/components/artifact/`: `PagePreview`, `PlaybookView`, `AdCard`, `BrandMark`. They render only our fields as
  text (no raw HTML, no links from model or site text; the call to action is an inert styled span, the quote form is
  decorative), accept **partial objects** so the same component renders a stream, show a skeleton when empty, and wrap
  long words. `AdCard` re-validates the accent (`normalizeAccent`), shows the generated image or, if there is none or it
  fails to load, the text-only branded card. `BrandMark` only accepts an `https:` logo (a scraped `javascript:` or `data:`
  value becomes the letter avatar).
- **Tested without a backend** on a development-only fixtures page (`/dev/artifact-fixtures`, normal / partial / empty /
  hostile states). It is a 404 in a production build (checked with `next build` + `next start`). 15 new browser tests;
  they skip when `E2E_BASE_URL` points at a deployed app.
- **Bug found by the tests and fixed:** a broken image on a server-rendered page can fail before React attaches `onError`,
  so the fallback never fired. Both `AdCard` and `BrandMark` now also check `complete && naturalWidth === 0` on mount.
- Results: unit 30/30, mocked 50/50 (35 earlier + 15 new), lint, types and production build clean.
- **Follow-up (not done):** the M1 `BrandCard` still hotlinks the scraped logo without the `https:` check that `BrandMark`
  has. A `javascript:` value in an `<img src>` does not run in modern browsers, so the risk is low, but it should use the
  same check.

## Milestone 3, step 4 (generate route) built (2026-11-23)
- **Added:** `POST /api/artifact/generate` (page and playbook: one streamed model request with `streamText` + `Output.object`;
  `launch_product`: the text-only ad card for now), `src/lib/artifact-store.ts` (claim, cap of 3, finish), `PAGE_PROMPT` and
  `PLAYBOOK_PROMPT`, `buildArtifactInput`, `SessionState.artifact`, the `artifact_generated` event.
- **The save happens before the response closes:** the text stream is piped through a `TransformStream` whose `flush`
  validates, clips and saves, so the client's refresh always finds the row. Never an error page: an invalid or failed model
  answer saves the deterministic fallback and logs `tool_failed` with a reason.
- **The claim:** an optimistic conditional write (same generation count and claim stamp, over PostgREST JSON-path filters), so
  6 parallel requests produced exactly 1 winner and 5 "busy"; the count never exceeds 3 (failures count, which caps cost).
  `finish` only writes if the session is still `building` and the claim is still ours.
- **Real-model findings (nvidia/nemotron-3.5-lightning-free), the reason for several changes:**
  1. First two real runs both saved the **fallback**: the model returned good content under its own keys (`Title`, `Tasks`,
     `Week`/`Timing`) so the SDK's strict schema parse failed. Fixed three ways: the prompts now spell out the exact JSON keys;
     the validators read keys tolerantly (case, spaces, synonyms); and the route falls back to `extractJson(result.text)`
     when the SDK parse fails. After that: playbook (11 s) and page (30 s) saved with `source: model`.
  2. **It is a reasoning model:** ~2,500 reasoning tokens (10 to 45 s) before it answers, then the whole answer arrives as ONE
     text delta, so the "stream" delivers a single chunk. The route is built to stream, but incremental delivery was not observed
     with this model. The route's cap is now 50 s (was 40 s) because one run took 45 s. A different or paid model would change this.
- **Tests:** unit 35/35 (new: tolerant keys, `extractJson`, the real model's capitalised answer, prompt builder); a live spec
  `e2e/artifact.live.spec.ts` (guards, card, cap, saved, parallel claim, hidden stale draft, and two paced model tests).
- **Moved:** the client `useObject` wiring is now part of step 6 (`BuildStep`), where it can be tested end to end.
- **One flaky test, not reproduced:** a preview test failed once while a live test was loading the same server; it then passed
  90/90 over six repeats. Unknown cause; watch for it.
- **Not done yet (spec'd for step 6):** `step/back` does not delete the draft or stored files yet. A leftover draft for another
  goal is hidden by `goal_type`, and the next claim for the new goal starts its own count.- **Live spec result:** `artifact.live.spec.ts` **7/7 pass** on a clean run (the guards, the card, the cap of 3, a saved
  artifact, 6 parallel requests, a hidden stale draft, and the two paced real-model tests, both `model`-written or labeled
  fallback). A first run showed 2 failures that were mine: I ran the mocked suite at the same time, and two Playwright runs
  wipe the same `test-results` folder (`ENOENT … traces`). Do not run two Playwright commands at once.
- Agent review of the route (read-only) found gaps to handle later: no screen calls the route yet (steps 5 and 6); when the
  user goes back mid-generation the route still answers 200 with nothing stored (`saved: false` is only logged); a server
  that dies mid-generation leaves a claim for 60 s that still counts toward the cap; `step/back` does not delete the draft yet;
  `filled` (parts rescued from the fallback) is not stored; `"blocked"` is spec'd as a reason but never used.

## Model constraints to remember (nvidia/nemotron-3.5-lightning-free, the free model in `MODEL_ID`)
Two things to know about this model, both seen in real runs on 2026-11-23, plus the limits we already knew:
1. **It is a reasoning model, so nothing streams mid-answer.** It thinks silently first (one raw run: about 2,500 reasoning
   tokens, 998 reasoning deltas, 45 s) and then sends the whole answer as ONE text delta. The route is built to stream
   (`streamText` + `Output.object`, the saved row exists before the response closes), but with this model the client gets a
   single chunk at the end, so a streamed preview shows nothing until it is done. Incremental delivery has NOT been observed.
   Seen timings: goal suggestions 3 to 5 s; playbook 11 to 16 s; landing page 28 to 30 s; one run took 45 s.
   Consequences: the build screen (step 6) must show named progress steps and an honest wait note ("up to a minute"), not rely
   on streamed text; the route's cap is 50 s with `maxDuration = 60`, so a run slower than that becomes the saved fallback
   (`reason: timeout`).
2. **It does not reliably follow the schema.** It returned good content under its own keys (`Title`, `Tasks`, `Week`/`Timing`),
   so a strict parse fails and the generic fallback would be saved. Handled by spelling out the exact JSON keys in the prompts,
   reading keys tolerantly in the validators, and parsing the raw text when the SDK's strict parse fails. A paid or different
   model may follow the schema and may stream.
- Already known: about 5 requests a minute (tests are paced, never two Playwright commands at once); weak tool calling.
- **Swapping the model is only `MODEL_ID`**, but re-check three things after a swap: does the answer follow the schema,
  does it stream (a check that counts chunks: the script that showed "1 chunk" is the one to rerun), and the latency.

## Milestone 3, step 5 (photo upload and the fal ad) built (2026-11-23)
### fal.ai: the first real call (the human added credit; the first attempt had been refused for balance)
- **Before credit:** fal answered **403** `{"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}`:
  proof the key and the `Authorization: Key ...` header format were right (a wrong key is 401), and the real error shape. It maps to
  the reason `billing`.
- **With credit:** `google/nano-banana-2.1/edit` via the queue worked on the first try. Submit: 200 `{status: "IN_QUEUE", request_id, response_url, status_url, cancel_url, ...}`.
  Polling: **HTTP 202 `IN_PROGRESS` while running, 200 `COMPLETED` when done** (so any 2xx is fine; read the `status` field). Result:
  `images[0] = {url, content_type: "image/jpeg", file_name, file_size: null, width: 1024, height: 1024}`; the output host was
  `v3b.fal.media` with `cache-control: public, max-age=5184000, immutable` (60 days). **Latency 17.6 s, 21.3 s, 21.8 s** per image
  (plus about 1 s each to sign and copy). `file_size` is null, so never rely on it.
- **fal accepted our Supabase signed URL as the reference image** (a 10-minute signed link to the private bucket).
- **Headline text:** "Fresh bread daily" and "Baked at dawn" were both spelled correctly and cleanly rendered; the second used the brand-blue
  accent from the prompt as the backdrop and kept the test photo's bread unchanged. **Only 2 results, on a test photo (the first on a
  random landscape, the second on an earlier output), not a real product: the spec's "5 or more runs on real products" check is still open.**
  Price per image: not measured (check the fal dashboard).
### What was built
- `src/lib/artifact/fal-client.ts` (pure: config in, never reads env; queue submit, poll, result; typed failure reasons; follows only
  URLs on the API's own origin; scrubs the key from errors), `src/lib/fal.ts` (server-only: config from env, guarded download of the
  output), `src/lib/artifact-storage.ts` (private `assets` bucket: upload, signed URL, remove), `POST /api/uploads/photo`, the ad branch of
  `POST /api/artifact/generate`, `SessionState.photo` and a signed `imageUrl` for the generated image, the `photo_uploaded` event.
- **Flow:** the photo is checked by its bytes and stored privately; fal gets a 10-minute signed URL of our copy; the output is
  downloaded (https and public host only, 15 s, 8 MB cap, type sniffed), **copied into our bucket**, and only our path is stored (no
  fal URL anywhere); the previous output is deleted when replaced. Any failure leaves a saved text-only card with the reason.
- **Fixed in this step:** the ad answer used to claim success even when nothing was stored (the user had gone back); it now
  answers 409 `wrong_step` and removes the file it copied.
### Tests
- Unit **44/44** (9 new for the fal client against a stub server, including the real 403 message, every error mapping, other-host
  URLs never followed, deadline, unreachable server, and the key never in an error). Live spec **10/10**: guards, the card, the cap,
  saved, parallel claim, hidden stale draft, upload refusals (text file named .jpg, GIF, SVG, empty, 5 MB, wrong goal, wrong step),
  type-decides-name and replacement, one real fal call, two real model calls. Mocked **50/50**, lint, types and the production build clean.
- Checked through the real route with `next start` and environment overrides (not kept as repo tests, they need a stub server on a
  fixed port): fal 403 billing, 429, an output URL that is http or private (refused), and no `FAL_KEY`: each saves the branded card
  with the reason, logs `tool_failed { tool: "fal" }`, and the key never appears in events.
### Still open
- Price per image; concurrency limit; the 5-run headline and product-fidelity check on real product photos; cleanup of stored
  files on `step/back` (step 6); the browser-side downsizing and the upload UI (step 6, `BuildStep`).

## Working rules decided during Milestone 3 (human)
- **Do not run tests that call fal.ai unless asked: they spend credit.** The one live test that makes a real fal call is skipped
  unless `RUN_FAL=1` is set. The mocked suite, the unit tests and the other live tests never call fal.
- **Build-screen progress is a light, time-based guide** (the steps advance on a timer and hold on the last one), labelled as a guide,
  because the free reasoning model gives no real progress signal.

## Milestone 3, step 6 (the build screen, save and hand-off) built (2026-11-23)
### What was built
- `BuildStep` replaces the placeholder end screen (`next-up-step.tsx` is deleted). States: **intro** (the chosen goal, a Generate button; for the ad a photo
  picker, headline and the "sent to an image service" line), **generating** (named steps on a timer plus any streamed partial object), **preview**
  (Regenerate with the remaining count, Save, Change my goal, a plain note when a standard version or a text-only card was used), **saved**
  (confirmation, the artifact, the hand-off card with the link, Start over; no way back). All derived from `SessionState`, so a refresh resumes.
- **Decisions:** (1) Generate is a **button, not automatic**: a model request or a fal call is always the user's choice, and it avoids a double
  start from React Strict Mode. (2) The progress steps are a **light time-based guide** (7 s per step, holds on the last one) and the screen says
  so; one `waiting` value is derived from the state (waiting until the server shows a newer generation), with no effect-driven state. (3) If the
  route answers `busy` (a reload, a second tab) the screen **polls the state** every 3 s and shows the result when it appears; after 75 s it offers
  Try again. (4) The photo is **shrunk in the browser** (1,600 px, JPEG 0.85; also drops location data); unreadable files such as HEIC are refused
  before any request with a plain message. (5) `useObject` wiring landed here (page and playbook); with the current model the stream is one chunk at
  the end, so the screen shows the steps and then the saved draft, which the server validated and saved before the response closed.
- **Server:** `POST /api/artifact/save` (idempotent; refuses a draft still being generated; logs `artifact_saved` once with `secondsSinceStart`),
  `POST /api/handoff` (only after saving; logs `handoff_clicked`), `step/back` now **deletes the draft, the generated image and the uploaded photo**
  (and forgets the photo on the profile) and refuses once saved, `supabase/queries/activation.sql` (median time to first saved artifact, funnel,
  goal chosen vs recommended, saved per goal and source, failures by tool, hand-off clicks per goal).
### Tests
- Mocked **66/66** (16 new for the build screen: each goal's full path, the timed steps with a fake clock, regenerate countdown and the 3-try limit, every
  fallback note, limit/network/busy/save errors, going back, refresh resume for each state, Start over, the ad photo flow, refused files, the hand-off
  link attributes and that it still opens when logging fails). Unit 44/44. Live: the new save, busy-save, hand-off and cleanup tests pass.
- One of my own tests matched two "current step" markers (the onboarding bar also uses `aria-current`); fixed the locator.
- **No test in this step calls fal.** The one that does is skipped unless `RUN_FAL=1`; none of the others generates an ad after a photo is uploaded.
### Still open
- Step 7: the deployed-URL run (mocked suite and live tests except the fal one), AC status table in NOTES, and the human's manual test with a real
  photo (the headline-spelling and product-fidelity check, still 2 results on test photos).
- Known gap: a generation that dies mid-way leaves a claim for 60 s that counts toward the cap of 3.

