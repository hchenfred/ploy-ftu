# SPEC — Milestone 4: "First win" part 2, publish and measure

Project: Ploy FTU (goal-first onboarding) · Take-home for Ploy
Milestone: 4 of 4 · Builds on: `SPEC.md` (M1), `SPEC-M2.md` (M2), `SPEC-M3.md` (M3)
**Depends on (from M3, exactly):** a `page` row in `artifacts` for the session (`data` validated by `PageDefinitionSchema`, `image_paths`, `slug = null`, `published_at = null`) with `sessions.status = 'building'`; `PageRenderer` (`src/components/page/page-renderer.tsx`, props `page`, `imageUrl`, `mode: "preview" | "public"`); `BuildStep`; the unique index `artifacts_session_type_key`; `meta.imageStatus`; `SessionState.page`; `src/lib/page/*` pure modules; the private `assets` bucket holding the draft image; `FAL_KEY` already in place (M4 adds no env var). From M2: `advanceStatus`, `loadSessionState`, `POST /api/step/back`, `resetSession()`.
Design doc / canvas: not in the repo. Screens are specified by content and behavior only.

Numbering continues from M3: FR-27 onward, AC-60 onward. Anything marked **(assumed)** is a decision made without a source in the repo; each is listed again in §12 with a recommended default.

---

## 1. Goal

Close the loop of the whole product on the deployed Vercel URL:

> The user publishes the page; the server gives it a slug and a public URL; anyone can open `/p/[slug]`, see the page, and (for form goals) submit it; the system counts visits, clicks and submissions; the user sees a "You're live" screen and a metrics page that says whether the page is working.

### Where M4 stops (unambiguous)

- Publishing is **final**: `building -> live` and nothing goes back. No unpublish, no edit-after-publish, no delete, no custom domain, no email or webhook notification of submissions, no auth, no ads or ad traffic, no cross-user (admin) metrics.
- `sessions.status = 'live'` is written only by the publish route, through `advanceStatus`.
- Start over means a **new session** (the old page stays published).

---

## 2. Tech stack (deltas only)

**No new npm dependencies and no new environment variables.** Used: Next.js 16 Cache Components (`'use cache'`, `cacheTag`, `cacheLife`, `revalidateTag`), `node:crypto` (HMAC, random bytes), `@supabase/supabase-js` (DB and Storage), `zod`.

Not in this milestone: Supabase Auth, analytics vendors, CAPTCHA, rate-limit services (Upstash/Redis), email.

> Checked against `node_modules/next/dist/docs/01-app` (installed Next 16.4.6): `'use cache'` functions must be async and take serializable arguments; `cacheLife` profiles are `seconds | minutes | hours | days | weeks | max`, and `cacheLife` may be called in different branches (only one runs per invocation); `revalidateTag(tag, profile)` requires a second argument and `{ expire: 0 }` means no stale serving; `updateTag` works only in Server Actions, so Route Handlers use `revalidateTag`; `notFound()` after streaming starts keeps status 200 with `noindex`, a 404 status only when it runs before the response starts; route handler `params` is a Promise. The implementer re-reads these pages before coding (the `'use cache'` and `params` rules interact with `partialPrefetching: true`, see FR-30).

---

## 3. Scope

### In scope
1. `POST /api/page/publish` with slug generation, public image copy, `live` transition.
2. Public server-rendered, cached `/p/[slug]` (shared `PageRenderer`), isolated from onboarding session creation.
3. Inquiry form: client island + `POST /api/p/[slug]/submit` with validation, honeypot, size cap, per-IP and per-artifact limits.
4. Visit and CTA-click tracking: `POST /api/p/[slug]/event` via a beacon.
5. `GET /api/sessions/[id]/metrics`, the `/metrics` page, the funnel from `ftu` events.
6. `LiveStep` ("You're live"), Publish button in `BuildStep`.
7. Migration `0004`, security headers for `/p/*`, tests (unit, mocked, seeded, live), deploy.

### Out of scope
Everything under "Where M4 stops", plus: sitemap/SEO tuning, OG images, i18n, A/B tests, form file uploads, per-field custom forms, submission export, spam ML, retention jobs, orphan cleanup in storage when a session is deleted.

---

## 4. Verified facts about the repo (the spec relies on these)

- `artifacts.slug` is `text unique`; `published_at` nullable; `submissions(artifact_id, data jsonb, created_at)` has **no** `ip` column and no index on `artifact_id`; `events` is indexed by `(name, created_at)` and by `session_id`. Verified in `0001_init.sql`.
- **The root layout mounts `SessionProvider` for every route** (`src/app/layout.tsx`), and the provider calls `POST /api/sessions` on mount when `localStorage.ftu_session_id` is missing. As is, every visitor of `/p/[slug]` and `/metrics` would create a `sessions` row and an `ftu_started` event, polluting the funnel. M4 moves the provider into a route group (FR-30).
- `events.session_id` is a foreign key to `sessions`. Visitor events on a public page are therefore stored under the **owner's** session id (the page's `artifacts.session_id`), distinguished by `props`.
- `next.config.ts` sets `cacheComponents: true` and `partialPrefetching: true`. Nothing in `src/` uses `'use cache'` yet.
- Public image decision input from M3: drafts live in the private `assets` bucket and are served by 1 h signed URLs; an expiring URL cannot be baked into a cached public page.
- No rate-limit infrastructure exists; the database and `events`/`submissions` rows are the only state available.

---

## 5. Functional requirements

### FR-27 Publish: `POST /api/page/publish`
- Body (Zod): `{ sessionId: uuid }`. Invalid 400; unknown session 404.
- Guards, in order: session `status === 'live'` and the page already has a slug returns the existing result (idempotent: `{ ok:true, slug, alreadyPublished:true }`, no second event); `status !== 'building'` 409 `{ error:"wrong_step" }`; no page artifact 409 `{ error:"no_page" }`.
- Steps (`publishPage()` in `src/lib/page/publish.ts`, `server-only`):
  1. Validate `artifacts.data` with `PageDefinitionSchema` (a corrupt row returns 500 `{ ok:false, reason:"invalid_page" }`, never publishes).
  2. **Image:** if `image_paths[0]` exists, copy it to the public bucket (FR-29). On failure, retry once; if it still fails, publish **without** the image: update `data.meta.imageStatus = "failed"`, `imageReason = "upload_failed"`. Publishing never fails because of an image.
  3. **Slug** (FR-28), then one conditional update: `update artifacts set slug = :slug, published_at = now(), data = :data where id = :id and published_at is null`. Zero rows changed means another call won the race: re-read and return its slug.
  4. `advanceStatus(sessionId, 'building', 'live')` (M2 helper, logs `step_changed`).
  5. `revalidateTag(`page:${slug}`, { expire: 0 })` so a cached "not found" for that slug cannot linger.
  6. Log `page_published { slug, goalType, source, imageStatus, hasForm }`.
- If step 3 succeeds but step 4 fails, a repeated call finds the slug set and only re-runs `advanceStatus` (safe: conditional update).
- Response: `{ ok:true, slug, path: "/p/{slug}", alreadyPublished: boolean }`. The client builds the absolute URL from `window.location.origin` (no base-URL env var, **assumed**).

### FR-28 Slug generation (`src/lib/slug.ts`, pure)
- `slugify(name)`: lowercase, strip accents (NFKD), non-alphanumerics to `-`, collapse and trim `-`, max 40 chars; empty result becomes `site`.
- Slug = `{slugify(business.name)}-{4 random chars of [a-z0-9]}` from `crypto.randomBytes`. The **random suffix is always appended** (not only on collision), so names never collide in practice, slugs are not guessable from the name alone, and reserved words are never an issue. Final format `^[a-z0-9]+(-[a-z0-9]+)*$`, max 50 chars (enforced by a DB check, §6).
- `assignSlug(name, tryWrite)` retries up to 5 times with a fresh suffix when `tryWrite` reports a unique violation (Postgres code `23505`), then fails with `{ ok:false, reason:"slug_unavailable" }` (publish returns 500 with that reason, no state change). `tryWrite` is injected so the retry logic is unit-testable.

### FR-29 Public image (decision)
- New **public** bucket `published` (migration `0004`); `assets` stays private. At publish, the server downloads the draft from `assets` and uploads it to `published/{slug}/hero.{ext}` (cross-bucket copy is download + upload). Why: published pages are cached and public, so they need a **stable** URL (a signed URL expires); drafts and anything else in `assets` (future uploads) must not become public by a bucket flip; the path contains the random slug suffix, and the bucket has no list policy.
- The public image URL is `getPublicUrl(`${slug}/hero.${ext}`)` from the Supabase client, computed server-side. `PageRenderer` shows the image iff `meta.imageStatus === "ok"` at render time; otherwise the flat-color hero (M3).
- Rendered with a plain `<img>` (no `next/image` remote pattern config, no new `next.config.ts` image settings).

### FR-30 Public page `/p/[slug]` and layout isolation
- **Move `SessionProvider` out of the root layout** into `src/app/(app)/layout.tsx`, and move the onboarding `page.tsx` to `src/app/(app)/page.tsx` (route groups do not change URLs). Root layout keeps fonts, `<html>`, `<body>`. `/p/[slug]` and `/metrics` live outside `(app)` and never create a session.
- `src/app/p/[slug]/page.tsx` (server component):
  - `slug` must match the slug format, else `notFound()` **without** a DB read.
  - Data comes from `getPublishedPage(slug)` (`src/lib/page/public.ts`, `server-only`), an async `'use cache'` function: `cacheTag(`page:${slug}`)`; when found `cacheLife("hours")`, when not found `cacheLife("seconds")`. It selects **explicit columns** `data, image_paths, published_at` where `slug = :slug and published_at is not null and type = 'page'`, validates with `PageDefinitionSchema`, and returns `{ page, imageUrl, hasForm }`. It never returns `session_id`, `artifact id` or the digest, so neither can leak into the HTML or RSC payload. Published pages are immutable (FR-36), so caching them is safe; per-request things (views) are **not** done during render, because a cached render cannot count visits (FR-33).
  - Unknown or unpublished slug: `notFound()`. To get a real **404 status**, `await params` and `getPublishedPage` run **outside** a `<Suspense>` boundary; the implementer verifies with `next build` that this is allowed with `partialPrefetching: true`. If the build rejects it, use `<Suspense>` and accept status 200 with `noindex` (recorded as a known gap, AC-70 relaxed to "shows the not-found page").
  - `generateMetadata`: title `{business name}`, description the hero subhead, `robots: { index: false }` (**assumed**, see §12).
  - Renders `<PageRenderer mode="public" …>` plus two client islands: `PageBeacon` (FR-33) and, inside the renderer, `InquiryForm` (FR-31) and `TrackedCta`.
- `next.config.ts` adds `headers()` for `/p/:path*`: `X-Frame-Options: DENY` (the form must not be framed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. No CSP in M4 (needs nonces with Next's inline scripts; listed as hardening).
- Same renderer as the preview, so what the user previewed is what is served (AC-69).

### FR-31 Inquiry form and `POST /api/p/[slug]/submit`
- `InquiryForm` (client island, rendered only when the page has a `form` section): labeled inputs from the section's `fields` (`autocomplete` attributes per key), one pill submit button (pending state), inline field errors tied with `aria-describedby`, a `role="status"` success message (the section's `successMessage`) replacing the form, and a `role="alert"` for server errors with the form kept filled. A **honeypot** input named `company` (visually hidden, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden`) is part of the form.
- Request: JSON `{ fields: { name?, email?, phone?, message? }, company: string }`.
- Server order, cheapest check first, each failure with a meaningful HTTP status (this is a public API; the always-200 convention of the internal routes does not apply):
  1. Body larger than **10 KB** returns 413 `{ ok:false, reason:"too_large" }`; unparseable JSON 400 `invalid`.
  2. If an `Origin` header is present and its host differs from `Host`, 403 `{ reason:"bad_origin" }` (casual cross-site posting only; not a security boundary).
  3. `company` non-empty: return **200 `{ ok:true }`** (pretend success), write nothing, log `submission_blocked { reason:"honeypot" }`.
  4. Slug format invalid or no published page: 404 `{ reason:"not_found" }`; page has no form section: 404 `{ reason:"no_form" }`.
  5. **Validate against the stored form definition**, not the request: only keys declared in the section's `fields` are accepted (others dropped); `name` 1-100 chars, `email` matches a simple address pattern and is at most 254 chars, `phone` matches `^[0-9+()\-.\s]{6,30}$`, `message` at most 2,000; strings trimmed, control characters stripped; a missing required field is an error. Failure 422 `{ ok:false, reason:"invalid", fields:{ email:"Enter a valid email" } }`.
  6. **Rate limits** (FR-32). Over the limit 429 `{ reason:"rate_limited" }` with `Retry-After`.
  7. Insert `submissions { artifact_id, data, ip_hash }`; log `form_submitted { purpose }` under the owner's session (no personal data in event props); respond `{ ok:true, message }`.
- Stored text is untrusted; it is only ever rendered as React text (FR-34).

### FR-32 Abuse basics (no new infrastructure)
- **IP source:** the first value of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else `"unknown"`. The IP is **never stored**: `ip_hash = hex(HMAC-SHA256(key = SUPABASE_SERVICE_ROLE_KEY, message = ip))` truncated to 32 chars (`src/lib/ip-hash.ts`, `server-only`; **assumed**: reusing the service key as the HMAC key avoids a new env var; rotating the key only resets limits).
- **Limits (assumed numbers):** per `(artifact, ip_hash)`: 5 submissions per 10 minutes; per artifact: 100 submissions per hour. Implemented as `count(*)` queries on `submissions` (new indexes, §6) before the insert. Concurrent requests can overshoot by a small margin; accepted.
- Honeypot (FR-31) and the 10 KB cap complete the set. A paced bot is not stopped; CAPTCHA is out of scope (listed under "Known gaps" in `NOTES.md`).

### FR-33 Tracking: `POST /api/p/[slug]/event`
- Why a beacon and not a render-time log: the page is cached, so a server render does not happen per visit.
- `PageBeacon` (client, in `src/components/page/page-beacon.tsx`): on mount, if `sessionStorage["ftu_viewed_{slug}"]` is unset, send `{ type:"view", vid }` and set it; `TrackedCta` sends `{ type:"cta_click", vid, action }` on click (`action` is the CTA's action from the page definition), then lets the link proceed. Sent with `navigator.sendBeacon` (JSON `Blob`) or `fetch(..., { keepalive:true })`; errors are swallowed.
- `vid` is a random uuid kept in `localStorage["ftu_visitor_id"]` (anonymous, no cookie, no personal data; if storage is blocked, `vid` is a fresh uuid per page load). **(assumed** no consent banner is needed for first-party anonymous counting; see §12.)
- Server: body Zod `{ type: "view" | "cta_click", vid: uuid, action?: enum }`; slug must resolve to a published page (explicit-column read, **not** the cached function, so a miss is cheap and fresh); `Origin` check as in FR-31; per-IP flood cap: at most 30 events per minute per `(artifact, ip_hash)` (count on `events` filtered by `session_id`, `name`, `created_at`, `props->>ip_hash`), excess dropped silently. Writes `page_viewed { artifactId, vid, ip_hash }` or `cta_clicked { artifactId, vid, action, ip_hash }` under the owner's session. Always responds 204 (the visitor sees nothing either way).
- The owner's own visits count. Crawlers that do not run JavaScript do not count. Both are accepted (stated on the metrics page: "Includes your own visits").

### FR-34 Metrics: `GET /api/sessions/[id]/metrics` and `/metrics`
- **What "protected" means (plain statement, assumed):** there is no auth. Anyone who holds the session uuid can read that session's metrics, including the recent submissions (names, emails, messages). The uuid is random (122 bits), stored only in the owner's `localStorage`, and the `/metrics` page reads it from there, so the URL does not contain it. It is **not** a credential: it travels in the API path (visible in server logs) and a person who obtains it, for example from a shared browser profile, can read the data. Real protection needs auth (out of scope; listed in §12).
- API: uuid else 400; unknown 404. Response (all computed by pure `computeMetrics()` in `src/lib/metrics.ts` from rows the route reads; no digest):
  ```ts
  type Metrics = {
    published: null | { slug: string; path: string; publishedAt: string; goalType: GoalType; hasForm: boolean };
    views: number; visitors: number;                 // visitors = distinct vid
    ctaClicks: { total: number; byAction: Record<string, number> };
    submissions: { total: number; recent: { id: string; createdAt: string; fields: Record<string, string> }[] }; // 10 newest, each value cut to 300 chars
    conversion: number | null;                       // actions / visitors, null when visitors = 0
    primary: { label: string; value: number };       // per goal, below
    funnel: { key: string; label: string; reachedAt: string | null }[];
    verdict: "not_published" | "no_visits" | "visits_no_action" | "working";
    capped: boolean;                                 // true if a 5,000-row read cap was hit
  };
  ```
- **Primary metric per goal (assumed):** goals with a form (`capture_and_follow_up`, `inbound_leads`, `paid_growth`): "Submissions". `local_customers` (no form): "Call and directions clicks" (`ctaClicks` where action is `call` or `directions`). `conversion` = primary value / visitors.
- **Funnel** from `ftu` events of the session (first occurrence time of each, null if never): Started (`ftu_started`), Site understood (`research_done` with `ok` or `description_saved`), Goal chosen (`goal_chosen`), Page built (`page_generated`), Published (`page_published`), First visit (`page_viewed`), First action (`form_submitted` or `cta_clicked`).
- **Verdict:** `not_published`; `no_visits` ("No visits yet. Share your link."); `visits_no_action` ("People are visiting, but nobody has acted yet."); `working` ("It's working: {n} {primary label}").
- `/metrics` page (client, outside `(app)`, no `SessionProvider`): reads `ftu_session_id` from `localStorage` **without creating one**. No id or a 404: "We can't find a session in this browser." with a link to `/`. Otherwise shows the verdict sentence first, then the four numbers (views, visitors, clicks, submissions), the funnel as an ordered list with times (steps never reached are marked "Not yet"), the recent submissions as a table (React text only; the section is hidden for goals without a form), the note "Includes your own visits", and a "Refresh" button plus auto-refresh every 15 s while the tab is visible. Fetch errors show `role="alert"` with "Try again"; the page is never blank.

### FR-35 "You're live" and the Publish button
- `BuildStep` (M3): replace the static "Coming soon" line with a **Publish page** pill button (pending state). `Regenerate` and `Change my goal` stay until publish succeeds. Click calls FR-27 then `onChange()`; on failure `role="alert"` "We couldn't publish your page." + "Try again" and the preview stays. Publishing is allowed for a `fallback`-source page (the user's call).
- `LiveStep` (`src/components/steps/live-step.tsx`), rendered for `status === 'live'` (progress shows all three steps completed: `live` maps to index 3 in the shell):
  - heading "Your page is live" (**assumed** copy); the full URL `{origin}/p/{slug}` in a read-only labeled input with a **Copy link** button (uses `navigator.clipboard.writeText`; falls back to selecting the input text; announces "Copied" in a `role="status"` region);
  - **Open page** (new tab, `rel="noopener noreferrer"`), **View metrics** (link to `/metrics`);
  - a "Is it working?" panel: the verdict sentence and the primary number from the metrics API, with Refresh (same endpoint, polling every 15 s while visible); metrics load errors show an inline retry and never hide the URL;
  - a text button **Start another site**: clears `ftu_session_id` and calls `resetSession()` (M2), showing step 1. The published page stays up.

### FR-36 State rules once live (edits to M2/M3 routes)
- `POST /api/step/back` with status `live`: 409 `{ error:"published" }`, no change. `POST /api/page/generate` and `POST /api/goals/choose` already return 409 outside `building` / `goal`. The shell shows `LiveStep` for `live` (M2 rendered `live` as the end state of `building`; M3 as `BuildStep`).
- `SessionState` gains `published: null | { slug: string; path: string }`.
- Published pages are never mutated after publish (this is what makes caching them safe).

### FR-37 Events
Extend `EventName`: `page_published`, `page_viewed`, `cta_clicked`, `form_submitted`, `submission_blocked`.

| Event | Written by | Session | Props |
| --- | --- | --- | --- |
| `page_published` | `/api/page/publish` | owner | `{ slug, goalType, source, imageStatus, hasForm }` |
| `page_viewed` | `/api/p/[slug]/event` | owner | `{ artifactId, vid, ip_hash }` |
| `cta_clicked` | `/api/p/[slug]/event` | owner | `{ artifactId, vid, action, ip_hash }` |
| `form_submitted` | `/api/p/[slug]/submit` | owner | `{ artifactId, purpose }` |
| `submission_blocked` | `/api/p/[slug]/submit` | owner | `{ artifactId, reason: "honeypot" }` |
| `tool_failed` (existing) | publish | owner | `{ tool: "publishPage", reason, detail? }` |

All written by server code, never by the model. Logging failures are caught as in M1.

---

## 6. Data model deltas (migration `supabase/migrations/0004_publish.sql`)

Written to be re-runnable (`if not exists`, `do $$` blocks):

```sql
-- Public bucket for the images of published pages. Drafts stay in the private `assets` bucket.
insert into storage.buckets (id, name, public)
values ('published', 'published', true)
on conflict (id) do update set public = true;

-- Hashed IP for rate limiting (never the raw IP).
alter table submissions add column if not exists ip_hash text;
create index if not exists submissions_artifact_created_idx on submissions (artifact_id, created_at desc);
create index if not exists submissions_artifact_ip_idx on submissions (artifact_id, ip_hash, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'artifacts_slug_format') then
    alter table artifacts add constraint artifacts_slug_format
      check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 50));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artifacts_published_has_slug') then
    alter table artifacts add constraint artifacts_published_has_slug
      check (published_at is null or slug is not null);
  end if;
end $$;
```
RLS stays on with **no policies** for all tables: nothing is readable by `anon`; public routes read through the server with the service role and explicit `where slug = … and published_at is not null`. The `published` bucket is public **read** by object URL only (no list policy, upload requires the service role). The deployed M3 app must keep working if `0004` is applied before the deploy.

---

## 7. Prompts

No prompt changes and no LLM calls in M4 (publishing, serving and measuring are deterministic). Submission text and event data are never sent to a model.

---

## 8. Project structure deltas

```
ploy-ftu/
├─ SPEC-M4.md
├─ next.config.ts                          # + headers() for /p/:path*
├─ supabase/migrations/0004_publish.sql
├─ e2e/
│  ├─ helpers.ts                           # extended (FR-T1)
│  ├─ publish-lib.unit.spec.ts             # new
│  ├─ publish.mocked.spec.ts               # new: route-intercepted UI
│  ├─ public.mocked.spec.ts                # new: seeded rows, no LLM, no fal
│  └─ publish.live.spec.ts                 # new
└─ src/
   ├─ app/
   │  ├─ layout.tsx                        # SessionProvider removed
   │  ├─ (app)/layout.tsx                  # SessionProvider mounted here
   │  ├─ (app)/page.tsx                    # moved from src/app/page.tsx
   │  ├─ p/[slug]/page.tsx                 # public page
   │  ├─ metrics/page.tsx                  # owner metrics (client)
   │  └─ api/
   │     ├─ page/publish/route.ts          # POST
   │     ├─ p/[slug]/submit/route.ts       # POST (public)
   │     ├─ p/[slug]/event/route.ts        # POST (public)
   │     └─ sessions/[id]/metrics/route.ts # GET
   ├─ components/
   │  ├─ page/inquiry-form.tsx             # client island
   │  ├─ page/tracked-cta.tsx              # client island
   │  ├─ page/page-beacon.tsx              # client island
   │  ├─ page/page-renderer.tsx            # edited: public mode wires form, CTA, image
   │  └─ steps/live-step.tsx               # new; build-step.tsx gets the Publish button
   └─ lib/
      ├─ slug.ts                           # pure
      ├─ metrics.ts                        # pure: computeMetrics
      ├─ page/submission.ts                # pure: validateSubmission(fields definition, input)
      ├─ page/publish.ts                   # server-only
      ├─ page/public.ts                    # server-only: getPublishedPage ('use cache')
      ├─ ip-hash.ts                        # server-only
      ├─ session-state.ts                  # SessionState.published
      └─ events.ts                         # + 5 event names
```
Edits to existing files: `/api/step/back` (409 on `live`), `src/app/page.tsx` shell logic (now `(app)/page.tsx`: `live` renders `LiveStep`, progress index 3), `session-provider` import path in layouts.

Rules carried over:
- Every file touching secrets or the service role imports `"server-only"` (`publish.ts`, `public.ts`, `ip-hash.ts`, all route files via the libs they use). `slug.ts`, `metrics.ts`, `submission.ts` and the client islands must **not** import server modules.
- No secret in any `NEXT_PUBLIC_*` variable; no new env vars; add only dependencies listed in §2 (none).

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Feedback | Publish, copy, submit and refresh show pending states; publish returns in under **5 s** (image copy included). |
| Public page performance | Cached render for found slugs (`hours`); no DB read during a cached hit; hero image from the public bucket; no client JS needed to read the page (only form, CTA tracking and the beacon). |
| Resilience | Publish never fails because of the image; tracking failures never affect the visitor; metrics and live screens degrade to a retry, never blank; publish and submit are idempotent or safely repeatable. |
| Security | Model and scraped text rendered as text only (M3 renderer); submissions validated against the stored form definition, size-capped, honeypot, per-IP and per-page limits with hashed IPs; slug format validated before any DB read; public routes select explicit columns and never expose session or artifact ids; service role server-only; RLS deny-all; clickjacking header on `/p/*`; no SSRF surface (the server fetches only fal's image URL under M3 rules; visitors' browsers, not the server, load the logo). |
| Privacy | No cookies; anonymous visitor id; raw IP never stored; submissions are the page owner's data, readable with the session uuid (FR-34). |
| Cost | No LLM or fal calls in M4. Storage: one image copy per publish. |
| Code quality | TypeScript strict; `npm run build` and `npm run lint` pass; M1, M2, M3 mocked suites green. |
| Accessibility | Form fields labeled, errors announced and associated, visible focus, 375 px width without horizontal scroll, contrast per the M3 theme rule. |

---

## 10. Testing strategy

Continues the repo pattern, with one clarification: public pages are server-rendered from the database, so Playwright route interception cannot fake them. The `mocked` project therefore means **no LLM and no fal**; tests that need a public page **seed real rows** in Supabase (service role, same env as `db()`) and delete the session afterwards (cascade). Nothing in M4 spends model or fal credits except one live test.

### FR-T1 Helpers
- `seedBuilding(page, { goalType, withImage? })`: M3's `seedSession` plus an `artifacts` row from `fixturePage(goalType)`; optional tiny PNG uploaded to `assets` through the Storage REST API.
- `seedPublished({ goalType, slug? })`: session `live`, published artifact with a random slug, optional image in `published`; returns `{ sessionId, slug }`. `cleanup(sessionId)` deletes the session. `dbInsert`, `dbDelete` REST helpers beside `db()`.
- `mockPublish`, `mockMetrics(page, body)` (intercepts `GET **/api/sessions/*/metrics`), `fixtureMetrics(verdict)`.

### Unit project (`e2e/publish-lib.unit.spec.ts`, no browser)
`slugify` and slug format, `assignSlug` retry with an injected `tryWrite` that reports `23505` twice then succeeds (and exhausts after 5), `validateSubmission` for each field rule, unknown keys dropped, control characters stripped, `computeMetrics` (funnel first-occurrence times, distinct visitors, primary metric per goal, verdict for each branch, 10-row recent cap), `ipFromHeaders` precedence.

### Mocked suite (`publish.mocked.spec.ts`, `public.mocked.spec.ts`, target under 30 s)
UI behaviors with intercepted routes (Publish button states, LiveStep, Copy link, metrics page states) and seeded-row tests for `/p/[slug]`, submit, event and rate-limit routes (the latter via Playwright's `request` fixture with `x-forwarded-for` set per test, never real network abuse).

### Live suite (`publish.live.spec.ts`)
Same 30 s `afterEach` pause. **One** full-chain test: seeded profile and goal, real LLM page (1 request) and real fal image (1 image), Publish, open `/p/[slug]`, submit the form, open `/metrics`; it is the only test that spends credits. The remaining live tests use `seedBuilding` / `seedPublished` (no model, no fal). `E2E_BASE_URL` points everything at Vercel; the cache check (AC-71) is a documented manual step because `next dev` does not cache like production.

---

## 11. Acceptance criteria

Everything must pass **on the deployed Vercel URL**, not just locally. `[U]` unit, `[M]` mocked or seeded, `[L]` live, `[D]` manual or DB check.

**Build and deploy**
- [ ] AC-60 `npm run build` and `npm run lint` pass; the M1, M2 and M3 mocked suites pass unchanged except where this spec edits behavior (the M3 "Coming soon" line becomes the Publish button). `[D]`
- [ ] AC-61 `0004_publish.sql` applied and re-runnable: bucket `published` exists and is public, `assets` is still private, `submissions.ip_hash`, the two indexes and both artifact constraints exist. No new env var or dependency was added (`git diff package.json` shows scripts only, if anything). `[D]`
- [ ] AC-62 Opening `/p/{any}` and `/metrics` in a fresh browser creates **zero** `sessions` rows and zero `ftu_started` events; opening `/` still creates exactly one (M1 AC-5). `[M]` + `[D]`
- [ ] AC-63 No secret value in `.next/static`; the HTML and RSC payload of `/p/[slug]` contain neither the session uuid nor the artifact id; public routes select explicit columns (code review); `rg "server-only"` shows it in every new file that touches secrets. `[D]`

**Pure logic**
- [ ] AC-64 `unit`: slug format and 40-char truncation, empty name gives `site`, suffix always appended; `assignSlug` retries on `23505` and gives up after 5; `validateSubmission` accepts valid input and rejects each bad field with a field-keyed message; `computeMetrics` gives the funnel, distinct visitors, per-goal primary metric and every verdict. `[U]`

**Publish**
- [ ] AC-65 Publish from `building` sets `slug` (valid format, random suffix), `published_at`, `sessions.status = 'live'`, one `step_changed {building, live}` and one `page_published`; the UI switches to `LiveStep` with progress complete; `{origin}/p/{slug}` loads. `[M]` (UI) + `[L]`
- [ ] AC-66 Publish is idempotent: two concurrent calls and a repeat after success yield one slug, one `page_published`, and the same response slug (`alreadyPublished: true` on the repeat). `[M]` (seeded, concurrent `request.post`) + `[L]`
- [ ] AC-67 Images: with an `ok` image, the published page's `<img>` loads anonymously from the public bucket URL (200, `image/*`), while the draft object's public URL under `assets` does not (4xx); with no image the page renders the flat hero and no `<img>` element. `[M]` + `[L]`
- [ ] AC-68 State guards: publish with status `goal` or `site` returns 409 `wrong_step`; with no page row 409 `no_page`; unknown session 404; non-uuid 400. Once `live`: `step/back`, `page/generate` and `goals/choose` all return 409 and change nothing. `[M]` (seeded) + `[L]`

**Public page**
- [ ] AC-69 `/p/[slug]` raw HTML (fetched without JavaScript) contains the `<h1>` headline, all sections of the stored definition in recipe order, a `<title>` with the business name, a `noindex` robots tag, and the `X-Frame-Options: DENY` header; the same `PageDefinition` shows identical text in the in-app preview. `[M]` + `[L]`
- [ ] AC-70 An invalid slug format or an unknown slug returns the not-found page (status 404 when the build allows it, FR-30) and an invalid format causes no DB query. `[M]`
- [ ] AC-71 Caching: after the first request, changing the row in the database (e.g. the headline) is **not** visible for a second request within the cache lifetime on a production build (`next start` or Vercel); the publish route calls `revalidateTag`. Record the observed result in `NOTES.md`. `[D]`
- [ ] AC-72 At 375 px width the page has no horizontal scroll; CTA and form are usable by keyboard. `[M]`

**Form and abuse**
- [ ] AC-73 A valid submission inserts one `submissions` row (`artifact_id`, `data`, `ip_hash` set, raw IP absent), shows the section's `successMessage`, and logs `form_submitted` under the owner's session with no personal data in props. `[M]` + `[L]`
- [ ] AC-74 Invalid input (missing name, bad email, phone with letters) shows field-level errors tied to their inputs, keeps the entered values, and writes nothing (422). `[M]` (UI) + `[L]` (API)
- [ ] AC-75 Honeypot: a request with `company` filled returns 200, shows success, writes **no** row, and logs `submission_blocked`. `[M]`
- [ ] AC-76 Rate limit: from one `x-forwarded-for`, the 6th submission within 10 minutes returns 429 with `Retry-After` and the UI shows "Too many submissions, try again later"; only 5 rows exist; a different IP is still accepted. `[M]` (seeded) + `[L]`
- [ ] AC-77 A body over 10 KB returns 413; keys not declared in the form definition are dropped; a message containing `<script>alert(1)</script>` is stored verbatim and displayed on `/metrics` as literal text (no script runs). `[M]`
- [ ] AC-78 For a page without a form section (`local_customers`), the submit route returns 404 `no_form` and no form is rendered. `[M]`

**Tracking and metrics**
- [ ] AC-79 Loading `/p/[slug]` records one `page_viewed` with a `vid`; a reload in the same tab does not add another; a new browser context adds one with a different `vid`; clicking the hero CTA records `cta_clicked` with its `action`; more than 30 events per minute from one IP are dropped. `[M]` (seeded) + `[L]`
- [ ] AC-80 `/metrics` shows the verdict sentence first, then views, visitors, clicks and submissions, the funnel with a time for each reached step and "Not yet" for the others, recent submissions as escaped text (hidden for `local_customers`), and "Includes your own visits". Each verdict branch renders its sentence. `[M]` (mocked API for each verdict) + `[L]` (real numbers match the seeded events and submissions)
- [ ] AC-81 Protection as stated in FR-34: no session in the browser or an unknown uuid shows "We can't find a session in this browser." with no session created; the metrics API returns 400 for a non-uuid and 404 for unknown; session A's metrics never include session B's events or submissions (two seeded sessions). `[M]` + `[L]`
- [ ] AC-82 `LiveStep` shows the full URL, **Copy link** puts it on the clipboard and announces "Copied", **Open page** opens a new tab with `rel` containing `noopener`, **View metrics** links to `/metrics`, the panel shows the verdict and refreshes, **Start another site** returns to step 1 with a new session while the old page still loads. `[M]` + `[L]`

**Failure paths**
- [ ] AC-83 Publish failures: a failing publish route shows the alert with "Try again" and leaves the preview; a forced image-copy failure still publishes, with `meta.imageStatus = "failed"`, and the page renders without an image; a slug conflict is retried (AC-64). `[M]` (UI) + `[D]` (force the copy failure and record it)
- [ ] AC-84 A failing metrics request shows the alert with "Try again" on `/metrics` and an inline retry on `LiveStep` while the URL stays visible; failing beacon requests change nothing for the visitor. `[M]`

**Explainability** (the reviewers pick parts at random)
- [ ] AC-85 You can explain, without notes:
  - what `publish` changes in the database and why it is safe to call twice;
  - why the page is cached but visits are counted by a beacon, and why published pages must be immutable;
  - why the public image gets its own public bucket and what would go wrong with signed URLs or a public `assets`;
  - how the form is validated against the stored definition, which abuse checks exist, and what they do not stop;
  - what "protected" means for `/metrics` without auth, and what a real fix would be;
  - why `SessionProvider` had to leave the root layout.

---

## 12. Open questions for the human (with recommended defaults)

1. **Is publishing final?** Default: yes (no unpublish, edit or delete); start over creates a new session. Alternative: an unpublish and "edit" loop, which means invalidating the cache and reworking regenerate.
2. **Metrics protection.** Default: the session uuid in `localStorage`, stated plainly in FR-34. Alternative: a separate random "owner token" returned at publish and required by the metrics API (small change, slightly stronger) before any real auth.
3. **Indexing.** Default: published pages are `noindex`. Alternative: indexable, which makes them real public websites and raises the stakes of the abuse protections.
4. **Visitor tracking and consent.** Default: anonymous random id in `localStorage`, no cookies, IP only as a keyed hash, no banner. Product or legal should confirm.
5. **Counting rules.** Default: owner visits and bots that run JavaScript count; the metrics page says so. Alternative: exclude visits from the owner's browser.
6. **Rate-limit numbers** (5 per 10 minutes per IP, 100 per hour per page, 30 events per minute) and the HMAC key reuse. Default as written; adjust after seeing real traffic.
7. **Slug style.** Default: `{business-name}-{4 random chars}` under `/p/`. Alternative: a custom slug input or a subdomain per page (needs DNS and a wildcard domain).
8. **Notify the owner of submissions** (email, webhook). Default: none; submissions are read on `/metrics`.
9. **Ad creatives for `paid_growth`.** Default: not built; the metrics treat `paid_growth` like the other form goals and no ad spend or traffic source is measured.
10. **Public image bucket vs serving images through our own route.** Default: public bucket `published` with the slug-suffixed path. Alternative: a route that streams the image from private storage (more control, no public bucket, extra function invocations).
11. **Copy** of the "You're live" screen, the verdict sentences and the funnel labels is my wording; the canvas is not in the repo.

---

## 13. Working agreement with the coding agent

- Work in small steps and **stop after each**, summarizing the files changed and why:
  1. migration `0004`; `slug.ts`, `submission.ts`, `metrics.ts`, `ip-hash.ts` with unit tests (AC-64 green);
  2. layout isolation (`(app)` group, provider moved): M1, M2 and M3 mocked suites green, `/p/x` and `/metrics` create no session (AC-62) before anything else is built;
  3. `POST /api/page/publish` + image copy + `SessionState.published` + Publish button + `LiveStep` (mocked tests, seeded tests);
  4. `/p/[slug]` with `'use cache'` (read the installed Cache Components docs first; check status 404 behavior with `next build`), headers in `next.config.ts`, renderer public mode;
  5. `InquiryForm` + submit route + abuse checks (seeded tests, `x-forwarded-for` per test);
  6. beacon + event route, `TrackedCta`;
  7. metrics API + `/metrics` + LiveStep panel;
  8. mocked tests, the single paced live full-chain test, deploy, the deployed-URL run, and the manual cache check (AC-71).
- Do not run the live suite while another live run is in progress (shared model budget and fal credits).
- Do not add libraries, abstractions or features beyond this spec; unpublish, editing, notifications and auth stay out even if they look easy.
- Verify Next.js 16 and AI SDK v7 APIs against the installed docs; `params` is async, `revalidateTag` needs a second argument, `updateTag` is Server Actions only.
- Keep appending to `NOTES.md` under "Milestone 4": decisions, human overrides, problems solved, per-AC results (same table style as M1 to M3), the cache check, and every `[D]` check done by hand. Finish by recording the whole-product run on the deployed URL (site, goal, page, publish, submission, metrics) for the Loom.
