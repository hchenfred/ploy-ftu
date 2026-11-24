> **NOT MVP: deferred to a later iteration.** On 2026-11-23 the MVP was re-scoped to three goals with one saved artifact each and no publishing; it is defined in `SPEC-M3.md`. This file was written for the previous plan, so parts of it are outdated (numbering, goal types, images, dependencies). It is kept as the starting point for the later iteration: publishing, the public `/p/[slug]` page, form submissions, the leads table, a test lead and `/metrics`.

# SPEC — Milestone 4: "First win" part 2, publish and measure

Project: Ploy FTU (goal-first onboarding) · Take-home for Ploy
Milestone: 5 of 5 (M3, M3B, then M4) · Builds on: `SPEC.md` (M1), `SPEC-M2.md` (M2), `SPEC-M3.md` (M3), `SPEC-M3B.md` (M3B)
**Depends on (from M3 and M3B, exactly):** a `page` row in `artifacts` for the session (`data` validated by `PageDefinitionSchema`, `slug = null`, `published_at = null`, `meta.goalKey` matching the session's goal) with `sessions.status = 'building'`; the goal catalog `GOAL_CATALOG`, `isAvailable` and `PRIMITIVE_NAMES` in `src/lib/goals.ts` (only `inbound_leads` and `paid_growth` reach M4); `PageRenderer` (`src/components/page/page-renderer.tsx`, props `page`, `mode: "preview" | "public"`; **no image prop**); `BuildStep`; the unique index `artifacts_session_type_key`; `SessionState.page`; `src/lib/page/*` pure modules; `goal_chosen`'s `primary`. From M3B, read-only: the private `ad_creative` row (never published in M4). From M2: `advanceStatus`, `loadSessionState`, `POST /api/step/back`, `resetSession()`.
Design doc / canvas: not in the repo. Screens are specified by content and behavior only.

Numbering continues from M3B (M3 ends at FR-28 / AC-64, M3B at FR-39 / AC-88): FR-40 onward, AC-89 onward. Anything marked **(assumed)** is a decision made without a source in the repo; each is listed again in §12 with a recommended default.

---

## 1. Goal

Close the loop of the whole product on the deployed Vercel URL:

> The user publishes the page; the server gives it a slug and a public URL; anyone can open `/p/[slug]`, see the page and submit its form; the submission lands in a **Leads** table (our stand-in for a PloyDB table) that the owner reads and updates in a spreadsheet-style view, and for `inbound_leads` the owner can send a clearly labeled **test lead** so the table works in the first session; the system counts visits, clicks and leads; the "You're live" screen offers the goal's next Ploy primitive as the call to action; a metrics page says whether the page is working.

Only the two available goals (`inbound_leads`, `paid_growth`) reach M4; both pages have a lead form.

### Where M4 stops (unambiguous)

- Publishing is **final**: `building -> live` and nothing goes back. No unpublish, no edit-after-publish, no delete, no custom domain, no email or webhook notification of submissions, no auth, no ads or ad traffic, no cross-user (admin) metrics.
- **The `paid_growth` ad creative is not published** (decision, §12 Q9): it stays a private preview in the owner's session; only the page is public. Publishing the ad is a next item.
- The "next primitive" call to action is a labeled "Coming soon" action that logs a click; no integration, no Ploybooks, no email.
- `sessions.status = 'live'` is written only by the publish route, through `advanceStatus`.
- Start over means a **new session** (the old page stays published).

---

## 2. Tech stack (deltas only)

**No new npm dependencies and no new environment variables.** Used: Next.js 16 Cache Components (`'use cache'`, `cacheTag`, `cacheLife`, `revalidateTag`), `node:crypto` (HMAC, random bytes), `@supabase/supabase-js` (DB and Storage), `zod`.

Not in this milestone: Supabase Auth, analytics vendors, CAPTCHA, rate-limit services (Upstash/Redis), email.

> Checked against `node_modules/next/dist/docs/01-app` (installed Next 16.4.6): `'use cache'` functions must be async and take serializable arguments; `cacheLife` profiles are `seconds | minutes | hours | days | weeks | max`, and `cacheLife` may be called in different branches (only one runs per invocation); `revalidateTag(tag, profile)` requires a second argument and `{ expire: 0 }` means no stale serving; `updateTag` works only in Server Actions, so Route Handlers use `revalidateTag`; `notFound()` after streaming starts keeps status 200 with `noindex`, a 404 status only when it runs before the response starts; route handler `params` is a Promise. The implementer re-reads these pages before coding (the `'use cache'` and `params` rules interact with `partialPrefetching: true`, see FR-43).

---

## 3. Scope

### In scope
1. `POST /api/page/publish` with slug generation and the `live` transition.
2. Public server-rendered, cached `/p/[slug]` (shared `PageRenderer`), isolated from onboarding session creation.
3. Inquiry form: client island + `POST /api/p/[slug]/submit` with validation, honeypot, size cap, per-IP and per-artifact limits.
4. Visit and CTA-click tracking: `POST /api/p/[slug]/event` via a beacon.
5. `GET /api/sessions/[id]/metrics`, the `/metrics` page, the funnel from `ftu` events.
6. **Leads table:** `submissions` as typed leads with a `status`, an owner-facing spreadsheet-style view on `/metrics`, `GET` and `PATCH` routes.
7. `LiveStep` ("You're live") with the goal's next-primitive call to action (`next_clicked`), the "Send a test lead" action (`inbound_leads` only), Publish button in `BuildStep`.
8. Migration `0004`, security headers for `/p/*`, tests (unit, mocked, seeded, live), deploy.

### Out of scope
Everything under "Where M4 stops", plus: publishing the ad creative, any image on the public page, lead editing beyond `status`, lead deletion, sitemap/SEO tuning, OG images, i18n, A/B tests, form file uploads, per-field custom forms, CSV export, spam ML, retention jobs, orphan cleanup in storage when a session is deleted.

---

## 4. Verified facts about the repo (the spec relies on these)

- `artifacts.slug` is `text unique`; `published_at` nullable; `submissions(artifact_id, data jsonb, created_at)` has **no** `ip` column and no index on `artifact_id`; `events` is indexed by `(name, created_at)` and by `session_id`. Verified in `0001_init.sql`.
- **The root layout mounts `SessionProvider` for every route** (`src/app/layout.tsx`), and the provider calls `POST /api/sessions` on mount when `localStorage.ftu_session_id` is missing. As is, every visitor of `/p/[slug]` and `/metrics` would create a `sessions` row and an `ftu_started` event, polluting the funnel. M4 moves the provider into a route group (FR-43).
- `events.session_id` is a foreign key to `sessions`. Visitor events on a public page are therefore stored under the **owner's** session id (the page's `artifacts.session_id`), distinguished by `props`.
- `next.config.ts` sets `cacheComponents: true` and `partialPrefetching: true`. Nothing in `src/` uses `'use cache'` yet.
- **The public page has no image.** M3 dropped every generated image; the page uses brand colors and the scraped `logoUrl`, a third-party URL that **visitors' browsers** load directly (hotlinked, `referrerPolicy="no-referrer"`, letter-avatar fallback). Consequence: the third-party host sees visitors' IPs and the logo can break or change; accepted for the MVP.
- `GOAL_CATALOG[goalType].next` (M3 FR-17) names the primitives the "You're live" screen advertises: `inbound_leads` gives `ploybooks`; `paid_growth` gives `integrations`, then `ploybooks`.
- No rate-limit infrastructure exists; the database and `events`/`submissions` rows are the only state available.

---

## 5. Functional requirements

### FR-40 Publish: `POST /api/page/publish`
- Body (Zod): `{ sessionId: uuid }`. Invalid 400; unknown session 404.
- Guards, in order: session `status === 'live'` and the page already has a slug returns the existing result (idempotent: `{ ok:true, slug, alreadyPublished:true }`, no second event); `status !== 'building'` 409 `{ error:"wrong_step" }`; no page artifact 409 `{ error:"no_page" }`.
- Steps (`publishPage()` in `src/lib/page/publish.ts`, `server-only`):
  1. Validate `artifacts.data` with `PageDefinitionSchema` (a corrupt row returns 500 `{ ok:false, reason:"invalid_page" }`, never publishes).
  2. **Slug** (FR-41), then one conditional update: `update artifacts set slug = :slug, published_at = now() where id = :id and published_at is null` (the stored `data` is published unchanged). Zero rows changed means another call won the race: re-read and return its slug.
  3. `advanceStatus(sessionId, 'building', 'live')` (M2 helper, logs `step_changed`).
  4. `revalidateTag(`page:${slug}`, { expire: 0 })` so a cached "not found" for that slug cannot linger.
  5. Log `page_published { slug, goalType, source, hasForm }`.
- Only the `page` row is touched; the `ad_creative` row and its objects stay private and unchanged.
- If step 2 succeeds but step 3 fails, a repeated call finds the slug set and only re-runs `advanceStatus` (safe: conditional update).
- Response: `{ ok:true, slug, path: "/p/{slug}", alreadyPublished: boolean }`. The client builds the absolute URL from `window.location.origin` (no base-URL env var, **assumed**).

### FR-41 Slug generation (`src/lib/slug.ts`, pure)
- `slugify(name)`: lowercase, strip accents (NFKD), non-alphanumerics to `-`, collapse and trim `-`, max 40 chars; empty result becomes `site`.
- Slug = `{slugify(business.name)}-{4 random chars of [a-z0-9]}` from `crypto.randomBytes`. The **random suffix is always appended** (not only on collision), so names never collide in practice, slugs are not guessable from the name alone, and reserved words are never an issue. Final format `^[a-z0-9]+(-[a-z0-9]+)*$`, max 50 chars (enforced by a DB check, §6).
- `assignSlug(name, tryWrite)` retries up to 5 times with a fresh suffix when `tryWrite` reports a unique violation (Postgres code `23505`), then fails with `{ ok:false, reason:"slug_unavailable" }` (publish returns 500 with that reason, no state change). `tryWrite` is injected so the retry logic is unit-testable.

### FR-42 Public page assets (decision: no images)
- The public page loads **no image from our storage**: no `published` bucket, no copy step, no `image_paths`. It shows the scraped `logoUrl` and brand colors only, exactly as the M3 renderer does in preview (`https:` only, `referrerPolicy="no-referrer"`, letter avatar on error or null). The logo is fetched by the visitor's browser from the site's own host; our server never fetches it (no SSRF surface here). The M3B ad image (private, signed URLs) is not part of the public page.
- Plain markup, no `next/image` and no `next.config.ts` image settings.

### FR-43 Public page `/p/[slug]` and layout isolation
- **Move `SessionProvider` out of the root layout** into `src/app/(app)/layout.tsx`, and move the onboarding `page.tsx` to `src/app/(app)/page.tsx` (route groups do not change URLs). Root layout keeps fonts, `<html>`, `<body>`. `/p/[slug]` and `/metrics` live outside `(app)` and never create a session.
- `src/app/p/[slug]/page.tsx` (server component):
  - `slug` must match the slug format, else `notFound()` **without** a DB read.
  - Data comes from `getPublishedPage(slug)` (`src/lib/page/public.ts`, `server-only`), an async `'use cache'` function: `cacheTag(`page:${slug}`)`; when found `cacheLife("hours")`, when not found `cacheLife("seconds")`. It selects **explicit columns** `data, published_at` where `slug = :slug and published_at is not null and type = 'page'`, validates with `PageDefinitionSchema`, and returns `{ page, hasForm }`. It never returns `session_id`, `artifact id` or the digest, so neither can leak into the HTML or RSC payload. Published pages are immutable (FR-49), so caching them is safe; per-request things (views) are **not** done during render, because a cached render cannot count visits (FR-46).
  - Unknown or unpublished slug: `notFound()`. To get a real **404 status**, `await params` and `getPublishedPage` run **outside** a `<Suspense>` boundary; the implementer verifies with `next build` that this is allowed with `partialPrefetching: true`. If the build rejects it, use `<Suspense>` and accept status 200 with `noindex` (recorded as a known gap, AC-99 relaxed to "shows the not-found page").
  - `generateMetadata`: title `{business name}`, description the hero subhead, `robots: { index: false }` (**assumed**, see §12).
  - Renders `<PageRenderer mode="public" …>` (no image prop; the logo is hotlinked, FR-42) plus two client islands: `PageBeacon` (FR-46) and, inside the renderer, `InquiryForm` (FR-44) and `TrackedCta`.
- `next.config.ts` adds `headers()` for `/p/:path*`: `X-Frame-Options: DENY` (the form must not be framed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. No CSP in M4 (needs nonces with Next's inline scripts; listed as hardening).
- Same renderer as the preview, so what the user previewed is what is served (AC-98).

### FR-44 Inquiry form and `POST /api/p/[slug]/submit`
- `InquiryForm` (client island, rendered only when the page has a `form` section): labeled inputs from the section's `fields` (`autocomplete` attributes per key), one pill submit button (pending state), inline field errors tied with `aria-describedby`, a `role="status"` success message (the section's `successMessage`) replacing the form, and a `role="alert"` for server errors with the form kept filled. A **honeypot** input named `company` (visually hidden, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden`) is part of the form.
- Request: JSON `{ fields: { name?, email?, phone?, message? }, company: string }`.
- Server order, cheapest check first, each failure with a meaningful HTTP status (this is a public API; the always-200 convention of the internal routes does not apply):
  1. Body larger than **10 KB** returns 413 `{ ok:false, reason:"too_large" }`; unparseable JSON 400 `invalid`.
  2. If an `Origin` header is present and its host differs from `Host`, 403 `{ reason:"bad_origin" }` (casual cross-site posting only; not a security boundary).
  3. `company` non-empty: return **200 `{ ok:true }`** (pretend success), write nothing, log `submission_blocked { reason:"honeypot" }`.
  4. Slug format invalid or no published page: 404 `{ reason:"not_found" }`; page has no form section: 404 `{ reason:"no_form" }`.
  5. **Validate against the stored form definition**, not the request: only keys declared in the section's `fields` are accepted (others dropped); `name` 1-100 chars, `email` matches a simple address pattern and is at most 254 chars, `phone` matches `^[0-9+()\-.\s]{6,30}$`, `message` at most 2,000; strings trimmed, control characters stripped; a missing required field is an error. Failure 422 `{ ok:false, reason:"invalid", fields:{ email:"Enter a valid email" } }`.
  6. **Rate limits** (FR-45). Over the limit 429 `{ reason:"rate_limited" }` with `Retry-After`.
  7. Insert one **lead**: `submissions { artifact_id, data, ip_hash }` with `status` defaulting to `'new'` (FR-51); log `form_submitted { purpose }` under the owner's session (no personal data in event props); respond `{ ok:true, message }`.
- **Write-only by construction (the PloyDB scoped-key idea):** the public routes can only insert; no public route reads, lists, updates or deletes a lead, and the public client never receives one back. Reads and `status` updates exist only on the owner routes of FR-51.
- Stored text is untrusted; it is only ever rendered as React text (FR-51).

### FR-45 Abuse basics (no new infrastructure)
- **IP source:** the first value of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else `"unknown"`. The IP is **never stored**: `ip_hash = hex(HMAC-SHA256(key = SUPABASE_SERVICE_ROLE_KEY, message = ip))` truncated to 32 chars (`src/lib/ip-hash.ts`, `server-only`; **assumed**: reusing the service key as the HMAC key avoids a new env var; rotating the key only resets limits).
- **Limits (assumed numbers):** per `(artifact, ip_hash)`: 5 submissions per 10 minutes; per artifact: 100 submissions per hour. Implemented as `count(*)` queries on `submissions` where `is_test = false` (new indexes, §6) before the insert. Concurrent requests can overshoot by a small margin; accepted.
- Honeypot (FR-44) and the 10 KB cap complete the set. A paced bot is not stopped; CAPTCHA is out of scope (listed under "Known gaps" in `NOTES.md`).

### FR-46 Tracking: `POST /api/p/[slug]/event`
- Why a beacon and not a render-time log: the page is cached, so a server render does not happen per visit.
- `PageBeacon` (client, in `src/components/page/page-beacon.tsx`): on mount, if `sessionStorage["ftu_viewed_{slug}"]` is unset, send `{ type:"view", vid }` and set it; `TrackedCta` sends `{ type:"cta_click", vid, action }` on click (`action` is the CTA's action from the page definition), then lets the link proceed. Sent with `navigator.sendBeacon` (JSON `Blob`) or `fetch(..., { keepalive:true })`; errors are swallowed.
- `vid` is a random uuid kept in `localStorage["ftu_visitor_id"]` (anonymous, no cookie, no personal data; if storage is blocked, `vid` is a fresh uuid per page load). **(assumed** no consent banner is needed for first-party anonymous counting; see §12.)
- Server: body Zod `{ type: "view" | "cta_click", vid: uuid, action?: enum }`; slug must resolve to a published page (explicit-column read, **not** the cached function, so a miss is cheap and fresh); `Origin` check as in FR-44; per-IP flood cap: at most 30 events per minute per `(artifact, ip_hash)` (count on `events` filtered by `session_id`, `name`, `created_at`, `props->>ip_hash`), excess dropped silently. Writes `page_viewed { artifactId, vid, ip_hash }` or `cta_clicked { artifactId, vid, action, ip_hash }` under the owner's session. Always responds 204 (the visitor sees nothing either way).
- The owner's own visits count. Crawlers that do not run JavaScript do not count. Both are accepted (stated on the metrics page: "Includes your own visits").

### FR-47 Metrics: `GET /api/sessions/[id]/metrics` and `/metrics`
- **What "protected" means (plain statement, assumed):** there is no auth. Anyone who holds the session uuid can read that session's metrics, including the leads (names, emails, messages, FR-51). The uuid is random (122 bits), stored only in the owner's `localStorage`, and the `/metrics` page reads it from there, so the URL does not contain it. It is **not** a credential: it travels in the API path (visible in server logs) and a person who obtains it, for example from a shared browser profile, can read the data. Real protection needs auth (out of scope; listed in §12).
- API: uuid else 400; unknown 404. Response (all computed by pure `computeMetrics()` in `src/lib/metrics.ts` from rows the route reads; no digest):
  ```ts
  type Metrics = {
    published: null | { slug: string; path: string; publishedAt: string; goalType: GoalType; hasForm: boolean };
    views: number; visitors: number;                 // visitors = distinct vid
    ctaClicks: { total: number; byAction: Record<string, number> };
    leads: { total: number; new: number; contacted: number };   // counts only; the rows come from FR-51
    conversion: number | null;                       // actions / visitors, null when visitors = 0
    primary: { label: string; value: number };       // per goal, below
    funnel: { key: string; label: string; reachedAt: string | null }[];
    verdict: "not_published" | "no_visits" | "visits_no_action" | "working";
    capped: boolean;                                 // true if a 5,000-row read cap was hit
  };
  ```
- **Test leads never count** (FR-53): every lead count, `conversion`, `primary` and the verdict are computed from rows with `is_test = false`, so a test lead can never turn "no visits" into "working". Test leads log no `form_submitted`, so the funnel's "First action" ignores them.
- **Primary metric (assumed):** both available goals have a lead form, so the primary metric is "Leads" (`leads.total`) for each. `conversion` = leads / visitors. (The earlier call-and-directions metric belonged to `local_customers` and is not built.)
- **Funnel** from `ftu` events of the session (first occurrence time of each, null if never): Started (`ftu_started`), Site understood (`research_done` with `ok` or `description_saved`), Goal chosen (`goal_chosen`), Page built (`page_generated`), Published (`page_published`), First visit (`page_viewed`), First action (`form_submitted` or `cta_clicked`).
- **Verdict:** `not_published`; `no_visits` ("No visits yet. Share your link."); `visits_no_action` ("People are visiting, but nobody has acted yet."); `working` ("It's working: {n} {primary label}").
- `/metrics` page (client, outside `(app)`, no `SessionProvider`): reads `ftu_session_id` from `localStorage` **without creating one**. No id or a 404: "We can't find a session in this browser." with a link to `/`. Otherwise shows the verdict sentence first, then the four numbers (views, visitors, clicks, leads), the funnel as an ordered list with times (steps never reached are marked "Not yet"), the leads table of FR-51, the note "Includes your own visits", and a "Refresh" button plus auto-refresh every 15 s while the tab is visible. Fetch errors show `role="alert"` with "Try again"; the page is never blank.

### FR-48 "You're live" and the Publish button
- `BuildStep` (M3): replace the static "Coming soon" line with a **Publish page** pill button (pending state). `Regenerate` and `Change my goal` stay until publish succeeds. Click calls FR-40 then `onChange()`; on failure `role="alert"` "We couldn't publish your page." + "Try again" and the preview stays. Publishing is allowed for a `fallback`-source page (the user's call).
- `LiveStep` (`src/components/steps/live-step.tsx`), rendered for `status === 'live'` (progress shows all three steps completed: `live` maps to index 3 in the shell):
  - heading "Your page is live" (**assumed** copy); the full URL `{origin}/p/{slug}` in a read-only labeled input with a **Copy link** button (uses `navigator.clipboard.writeText`; falls back to selecting the input text; announces "Copied" in a `role="status"` region);
  - **Open page** (new tab, `rel="noopener noreferrer"`), **View metrics** (link to `/metrics`);
  - a "Is it working?" panel: the verdict sentence and the primary number from the metrics API, with Refresh (same endpoint, polling every 15 s while visible); metrics load errors show an inline retry and never hide the URL;
  - **Next step (conversion hook):** a panel titled "Next for your {goal label}" that shows the goal's `GOAL_CATALOG[goalType].next` primitives as calls to action, with our fixed copy per primitive: `ploybooks` for `inbound_leads`: "Draft a reply to each new lead with Ploybooks"; `integrations` then `ploybooks` for `paid_growth`: "Connect your ad account" and "Get a weekly summary with a Ploybook". Each is a button labeled "Coming soon" that, on click, sends `POST /api/sessions/[id]/next` (FR-52), then shows `role="status"` "Thanks, we've noted that. This isn't available yet." **No integration, no Ploybooks, no email is built.** This is the product's monetization hook in the MVP: the click is the signal for what to build and sell next (§12 Q12);
  - for `inbound_leads` only, **Send a test lead** (FR-53) with the text "This is a test. Nothing is sent anywhere; it only adds a sample row to your leads table." and, after success, a link "View your leads" to `/metrics`;
  - a text button **Start another site**: clears `ftu_session_id` and calls `resetSession()` (M2), showing step 1. The published page stays up.

### FR-49 State rules once live (edits to M2/M3 routes)
- `POST /api/step/back` with status `live`: 409 `{ error:"published" }`, no change. `POST /api/page/generate` and `POST /api/goals/choose` already return 409 outside `building` / `goal`. The shell shows `LiveStep` for `live` (M2 rendered `live` as the end state of `building`; M3 as `BuildStep`).
- `SessionState` gains `published: null | { slug: string; path: string }`.
- Published pages are never mutated after publish (this is what makes caching them safe).

### FR-50 Events
Extend `EventName`: `page_published`, `page_viewed`, `cta_clicked`, `form_submitted`, `submission_blocked`, `lead_status_changed`, `next_clicked`, `test_lead_sent`.

| Event | Written by | Session | Props |
| --- | --- | --- | --- |
| `page_published` | `/api/page/publish` | owner | `{ slug, goalType, source, hasForm }` |
| `page_viewed` | `/api/p/[slug]/event` | owner | `{ artifactId, vid, ip_hash }` |
| `cta_clicked` | `/api/p/[slug]/event` | owner | `{ artifactId, vid, action, ip_hash }` |
| `form_submitted` | `/api/p/[slug]/submit` | owner | `{ artifactId, purpose }` |
| `submission_blocked` | `/api/p/[slug]/submit` | owner | `{ artifactId, reason: "honeypot" }` |
| `lead_status_changed` | `/api/sessions/[id]/leads/[leadId]` | owner | `{ artifactId, from, to }` (no lead content) |
| `test_lead_sent` | `/api/sessions/[id]/test-lead` | owner | `{ artifactId, n }` |
| `next_clicked` | `/api/sessions/[id]/next` | owner | `{ goalType, primitive }` |
| `tool_failed` (existing) | publish | owner | `{ tool: "publishPage", reason, detail? }` |

All written by server code, never by the model. Logging failures are caught as in M1.

### FR-51 Leads table (the PloyDB framing) and the owner's leads view
Form submissions are presented as a **Leads** table, our stand-in for a PloyDB table: typed fields, a `status`, write-only public access, owner-only read.
- **Typed fields:** `src/lib/leads.ts` (pure) exports `LEAD_STATUSES = ["new", "contacted"]`, `LEAD_COLUMNS` (`name`: text, `email`: email, `phone`: phone, `message`: long text, plus the system columns `created` and `status`) and the validators `validateSubmission` already uses (FR-44), so the type of each column is the validation rule of its field. The values stay in `submissions.data` (jsonb); the columns shown are the form's declared fields (FR-44 step 5).
- **Owner read:** `GET /api/sessions/[id]/leads`: uuid else 400, unknown 404; returns up to 200 newest leads `{ id, createdAt, status, isTest, fields }` for the session's `page` artifact (each value cut to 300 chars), `{ total, capped }`. No `ip_hash`, no artifact id, no session id of others. Same no-auth model as FR-47, stated there.
- **Status change:** `PATCH /api/sessions/[id]/leads/[leadId]`, body (Zod) `{ status: "new" | "contacted" }`; uuid checks on both ids; the lead must belong to **this session's** page artifact (a join, not a client-supplied artifact id), else 404; a conditional update; logs `lead_status_changed { artifactId, from, to }` only if the value changed; responds `{ ok: true, status }`. Params are Promises. No other field is writable; no delete.
- **View (`src/components/leads-table.tsx`, client):** rendered on `/metrics` under the heading "Your leads" with the hint "This is your PloyDB leads table." (**assumed** wording, a short explanation that leads are stored as a table with typed columns). A simple table: column headers, one row per lead, a test lead (`isTest`) shows a text badge "Test" next to its first value and is otherwise a normal row; the `status` column a labeled `<select>` ("Status for {name or row n}") with `new` and `contacted`, changed with an optimistic update that rolls back with an inline `role="alert"` if the request fails. All values are React text. Empty state: "No leads yet. Share your link." Hidden only if the page has no form section.
- `submissions.status` and `submissions.is_test` are added by migration `0004` (§6).

### FR-52 Next-step click: `POST /api/sessions/[id]/next`
Body (Zod) `{ primitive: Primitive }` (the closed union from `src/lib/goals.ts`); uuid else 400; unknown session 404; status must be `live` else 409; the primitive must be in `GOAL_CATALOG[session goal].next` else 400 (the client cannot log arbitrary primitives). Logs `next_clicked { goalType, primitive }` and responds `{ ok: true }`. Writes nothing else. The panel (FR-48) sends at most once per primitive per mount.

### FR-53 Send a test lead: `POST /api/sessions/[id]/test-lead` (`inbound_leads` only)
Neither goal delivers value without traffic, so after publishing the owner can see the Leads table work immediately.
- The button **Send a test lead** appears on `LiveStep` (FR-48) and at the top of the leads view (FR-51), only when the session's goal is `inbound_leads`. A short line states it plainly: "This is a test. Nothing is sent anywhere; it only adds a sample row to your leads table."
- The route takes **only the session id from the path** (uuid else 400; unknown 404). **It accepts no content from the browser**: the request body is ignored. Guards, in order: the session's page is not published 409 `{ error: "not_published" }`; the goal is not `inbound_leads` 409 `{ error: "not_available" }`; the page already has 3 test leads (`count where is_test`) 409 `{ error: "limit" }`.
- It inserts one lead with fixed content: `data = { name: "Test lead", email: "test@example.invalid", message: "This is a test lead sent from your first-time setup" }`, `status 'new'`, `is_test = true`, `ip_hash` null, then logs `test_lead_sent { artifactId, n }` (`n` = test leads now) and responds `{ ok: true, count: n }`. It does **not** log `form_submitted`. Two parallel clicks can overshoot the cap by one (accepted).
- Test leads appear in the leads view with the "Test" badge and a `status` like any lead, and are excluded from every metric (FR-47) and from the public rate limit (FR-45). The button is disabled at the cap with "You've sent the 3 test leads."

---

## 6. Data model deltas (migration `supabase/migrations/0004_publish.sql`)

Plain statements, **not** `do $$` blocks: pasting `do` blocks into the Supabase SQL editor failed partially for `0002` (NOTES, Milestone 2). Constraints use drop-if-exists then add, columns and indexes use `if not exists`, so the file is safe to run twice:

```sql
-- Hashed IP for rate limiting (never the raw IP).
alter table submissions add column if not exists ip_hash text;

-- Leads: a status the owner can change (the PloyDB-style table).
alter table submissions add column if not exists status text not null default 'new';
alter table submissions drop constraint if exists submissions_status_valid;
alter table submissions add constraint submissions_status_valid check (status in ('new', 'contacted'));

-- Test leads (FR-53): excluded from metrics and rate limits.
alter table submissions add column if not exists is_test boolean not null default false;

create index if not exists submissions_artifact_created_idx on submissions (artifact_id, created_at desc);
create index if not exists submissions_artifact_ip_idx on submissions (artifact_id, ip_hash, created_at desc);

alter table artifacts drop constraint if exists artifacts_slug_format;
alter table artifacts add constraint artifacts_slug_format
  check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 50));

alter table artifacts drop constraint if exists artifacts_published_has_slug;
alter table artifacts add constraint artifacts_published_has_slug
  check (published_at is null or slug is not null);
```
No storage bucket is created (no public images). RLS stays on with **no policies** for all tables: nothing is readable by `anon`; public routes read through the server with the service role and explicit `where slug = … and published_at is not null`. Lead rows are never readable or writable by `anon`: the public submit route inserts with the service role, and the owner routes (FR-51) read and update through the server. The deployed M3 app must keep working if `0004` is applied before the deploy.

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
│  ├─ public.mocked.spec.ts                # new: seeded rows, no LLM
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
   │     ├─ sessions/[id]/metrics/route.ts # GET
   │     ├─ sessions/[id]/leads/route.ts   # GET (owner)
   │     ├─ sessions/[id]/leads/[leadId]/route.ts   # PATCH status (owner)
   │     ├─ sessions/[id]/next/route.ts    # POST next_clicked
   │     └─ sessions/[id]/test-lead/route.ts   # POST test lead (inbound_leads)
   ├─ components/
   │  ├─ page/inquiry-form.tsx             # client island
   │  ├─ page/tracked-cta.tsx              # client island
   │  ├─ page/page-beacon.tsx              # client island
   │  ├─ leads-table.tsx                   # client: spreadsheet-style leads view
   │  ├─ send-test-lead.tsx                # client: button used by LiveStep and the leads view
   │  ├─ page/page-renderer.tsx            # edited: public mode wires form and CTA (no image)
   │  └─ steps/live-step.tsx               # new; build-step.tsx gets the Publish button
   └─ lib/
      ├─ slug.ts                           # pure
      ├─ metrics.ts                        # pure: computeMetrics
      ├─ leads.ts                          # pure: LEAD_STATUSES, LEAD_COLUMNS
      ├─ page/submission.ts                # pure: validateSubmission(fields definition, input)
      ├─ page/publish.ts                   # server-only
      ├─ page/public.ts                    # server-only: getPublishedPage ('use cache')
      ├─ ip-hash.ts                        # server-only
      ├─ session-state.ts                  # SessionState.published
      └─ events.ts                         # + 8 event names
```
Edits to existing files: `/api/step/back` (409 on `live`), `src/app/page.tsx` shell logic (now `(app)/page.tsx`: `live` renders `LiveStep`, progress index 3), `session-provider` import path in layouts.

Rules carried over:
- Every file touching secrets or the service role imports `"server-only"` (`publish.ts`, `public.ts`, `ip-hash.ts`, all route files via the libs they use). `slug.ts`, `metrics.ts`, `submission.ts` and the client islands must **not** import server modules.
- No secret in any `NEXT_PUBLIC_*` variable; no new env vars; add only dependencies listed in §2 (none).

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Feedback | Publish, copy, submit and refresh show pending states; publish returns in under **3 s**. |
| Public page performance | Cached render for found slugs (`hours`); no DB read during a cached hit; no image from our storage; no client JS needed to read the page (only form, CTA tracking and the beacon). |
| Resilience | Tracking failures never affect the visitor; metrics and live screens degrade to a retry, never blank; publish and submit are idempotent or safely repeatable. |
| Security | Model and scraped text rendered as text only (M3 renderer); submissions validated against the stored form definition, size-capped, honeypot, per-IP and per-page limits with hashed IPs; slug format validated before any DB read; public routes select explicit columns and never expose session or artifact ids; service role server-only; RLS deny-all; clickjacking header on `/p/*`; leads are insert-only for the public and readable or updatable only by the owner routes, which join through the session's own artifact. SSRF: M4 itself makes no outbound fetch; the guarded fetches of scraped image URLs and fal output live in M3B (`fetch-image.ts`) and the ad is not published. **Visitors' browsers load the third-party logo** from the site's own host, so that host sees visitor IPs; our server never fetches it. |
| Privacy | No cookies; anonymous visitor id; raw IP never stored; submissions are the page owner's data, readable with the session uuid (FR-47, FR-51). |
| Cost | No LLM or fal calls in M4. No storage use. |
| Code quality | TypeScript strict; `npm run build` and `npm run lint` pass; M1, M2, M3 mocked suites green. |
| Accessibility | Form fields labeled, errors announced and associated, visible focus, 375 px width without horizontal scroll, contrast per the M3 theme rule. |

---

## 10. Testing strategy

Continues the repo pattern, with one clarification: public pages are server-rendered from the database, so Playwright route interception cannot fake them. The `mocked` project therefore means **no LLM and no fal** (M4 never calls either); tests that need a public page **seed real rows** in Supabase (service role, same env as `db()`) and delete the session afterwards (cascade). Only one live test spends a model request.

### FR-T1 Helpers
- `seedBuilding(page, { goalType })` (an available goal): M3's `seedSession` plus an `artifacts` row from `fixturePage(goalType)`.
- `seedPublished({ goalType, slug?, leads? })`: session `live`, published artifact with a random slug, optional seeded lead rows with statuses; returns `{ sessionId, slug }`. `cleanup(sessionId)` deletes the session. `dbInsert`, `dbDelete` REST helpers beside `db()`.
- `mockPublish`, `mockMetrics(page, body)` (intercepts `GET **/api/sessions/*/metrics`), `fixtureMetrics(verdict)`, `mockLeads(page, rows)` and `mockLeadStatus(page)` (record `PATCH` bodies), `mockNext(page)`, `mockTestLead(page)`.

### Unit project (`e2e/publish-lib.unit.spec.ts`, no browser)
`slugify` and slug format, `assignSlug` retry with an injected `tryWrite` that reports `23505` twice then succeeds (and exhausts after 5), `validateSubmission` for each field rule, unknown keys dropped, control characters stripped, `computeMetrics` (funnel first-occurrence times, distinct visitors, the leads count and conversion with test rows ignored, verdict for each branch), `ipFromHeaders` precedence.

### Mocked suite (`publish.mocked.spec.ts`, `public.mocked.spec.ts`, target under 30 s)
UI behaviors with intercepted routes (Publish button states, LiveStep, Copy link, metrics page states) and seeded-row tests for `/p/[slug]`, submit, event and rate-limit routes (the latter via Playwright's `request` fixture with `x-forwarded-for` set per test, never real network abuse).

### Live suite (`publish.live.spec.ts`)
Same 30 s `afterEach` pause. **One** full-chain test: seeded profile and goal, real LLM page (1 request), Publish, open `/p/[slug]`, submit the form, change the lead's status, send a test lead, open `/metrics`; it is the only test that spends a model request (no fal anywhere in M4). The remaining live tests use `seedBuilding` / `seedPublished` (no model, no fal). `E2E_BASE_URL` points everything at Vercel; the cache check (AC-100) is a documented manual step because `next dev` does not cache like production.

---

## 11. Acceptance criteria

Everything must pass **on the deployed Vercel URL**, not just locally. `[U]` unit, `[M]` mocked or seeded, `[L]` live, `[D]` manual or DB check.

**Build and deploy**
- [ ] AC-89 `npm run build` and `npm run lint` pass; the M1, M2, M3 and M3B mocked suites pass unchanged except where this spec edits behavior (the M3 "Coming soon" line becomes the Publish button). `[D]`
- [ ] AC-90 `0004_publish.sql` applied and re-runnable (it has no `do $$` block): `submissions.ip_hash`, `status` (default `new`, check), `is_test` (default false), the two indexes and both artifact constraints exist; **no** `published` bucket was created and `assets` is still private. No new env var or dependency was added. `[D]`
- [ ] AC-91 Opening `/p/{any}` and `/metrics` in a fresh browser creates **zero** `sessions` rows and zero `ftu_started` events; opening `/` still creates exactly one (M1 AC-5). `[M]` + `[D]`
- [ ] AC-92 No secret value in `.next/static`; the HTML and RSC payload of `/p/[slug]` contain neither the session uuid nor the artifact id; public routes select explicit columns (code review); `rg "server-only"` shows it in every new file that touches secrets. `[D]`

**Pure logic**
- [ ] AC-93 `unit`: slug format and 40-char truncation, empty name gives `site`, suffix always appended; `assignSlug` retries on `23505` and gives up after 5; `validateSubmission` accepts valid input and rejects each bad field with a field-keyed message; `computeMetrics` gives the funnel, distinct visitors, the leads count, conversion and every verdict, and **ignores** rows with `is_test`; `LEAD_STATUSES` and `LEAD_COLUMNS` match FR-51. `[U]`

**Publish**
- [ ] AC-94 Publish from `building` sets `slug` (valid format, random suffix), `published_at`, `sessions.status = 'live'`, one `step_changed {building, live}` and one `page_published`; the UI switches to `LiveStep` with progress complete; `{origin}/p/{slug}` loads. `[M]` (UI) + `[L]`
- [ ] AC-95 Publish is idempotent: two concurrent calls and a repeat after success yield one slug, one `page_published`, and the same response slug (`alreadyPublished: true` on the repeat). `[M]` (seeded, concurrent `request.post`) + `[L]`
- [ ] AC-96 No images: the published page has no `<img>` pointing at our storage; the logo, when present, is an `https` hotlink with `referrerPolicy="no-referrer"` and a letter avatar when null or broken; the page shows brand colors; for a `paid_growth` session the `ad_creative` row, its objects and its text appear nowhere in the public HTML or RSC payload. `[M]` + `[L]`
- [ ] AC-97 State guards: publish with status `goal` or `site` returns 409 `wrong_step`; with no page row 409 `no_page`; unknown session 404; non-uuid 400. Once `live`: `step/back`, `page/generate` and `goals/choose` all return 409 and change nothing. `[M]` (seeded) + `[L]`

**Public page**
- [ ] AC-98 `/p/[slug]` raw HTML (fetched without JavaScript) contains the `<h1>` headline, all sections of the stored definition in recipe order, a `<title>` with the business name, a `noindex` robots tag, and the `X-Frame-Options: DENY` header; the same `PageDefinition` shows identical text in the in-app preview. `[M]` + `[L]`
- [ ] AC-99 An invalid slug format or an unknown slug returns the not-found page (status 404 when the build allows it, FR-43) and an invalid format causes no DB query. `[M]`
- [ ] AC-100 Caching: after the first request, changing the row in the database (e.g. the headline) is **not** visible for a second request within the cache lifetime on a production build (`next start` or Vercel); the publish route calls `revalidateTag`. Record the observed result in `NOTES.md`. `[D]`
- [ ] AC-101 At 375 px width the page has no horizontal scroll; CTA and form are usable by keyboard. `[M]`

**Form and abuse**
- [ ] AC-102 A valid submission inserts one `submissions` row (`artifact_id`, `data`, `ip_hash` set, raw IP absent, `status 'new'`, `is_test` false), shows the section's `successMessage`, and logs `form_submitted` under the owner's session with no personal data in props. `[M]` + `[L]`
- [ ] AC-103 Invalid input (missing name, bad email, phone with letters) shows field-level errors tied to their inputs, keeps the entered values, and writes nothing (422). `[M]` (UI) + `[L]` (API)
- [ ] AC-104 Honeypot: a request with `company` filled returns 200, shows success, writes **no** row, and logs `submission_blocked`. `[M]`
- [ ] AC-105 Rate limit: from one `x-forwarded-for`, the 6th submission within 10 minutes returns 429 with `Retry-After` and the UI shows "Too many submissions, try again later"; only 5 rows exist; a different IP is still accepted; seeded test leads do not count toward the limit. `[M]` (seeded) + `[L]`
- [ ] AC-106 A body over 10 KB returns 413; keys not declared in the form definition are dropped; a message containing `<script>alert(1)</script>` is stored verbatim and displayed in the leads view as literal text (no script runs). `[M]`
- [ ] AC-107 For a seeded page whose definition has no form section, the submit route returns 404 `no_form` and no form is rendered (neither available goal produces such a page; this guards the code path). `[M]`

**Tracking and metrics**
- [ ] AC-108 Loading `/p/[slug]` records one `page_viewed` with a `vid`; a reload in the same tab does not add another; a new browser context adds one with a different `vid`; clicking the hero CTA records `cta_clicked` with its `action`; more than 30 events per minute from one IP are dropped. `[M]` (seeded) + `[L]`
- [ ] AC-109 `/metrics` shows the verdict sentence first, then views, visitors, clicks and leads, the funnel with a time for each reached step and "Not yet" for the others, the leads table, and "Includes your own visits". Each verdict branch renders its sentence. `[M]` (mocked API for each verdict) + `[L]` (real numbers match the seeded events and leads)
- [ ] AC-110 Protection as stated in FR-47: no session in the browser or an unknown uuid shows "We can't find a session in this browser." with no session created; the metrics and leads APIs return 400 for a non-uuid and 404 for unknown; session A's metrics and leads never include session B's events or leads (two seeded sessions). `[M]` + `[L]`
- [ ] AC-111 `LiveStep` shows the full URL, **Copy link** puts it on the clipboard and announces "Copied", **Open page** opens a new tab with `rel` containing `noopener`, **View metrics** links to `/metrics`, the panel shows the verdict and refreshes, **Start another site** returns to step 1 with a new session while the old page still loads. `[M]` + `[L]`

**Leads, next step and test lead**
- [ ] AC-112 Leads view: after a submission, `/metrics` shows a table with the form's columns and a `status` select; changing it to `contacted` sends one `PATCH` `{ status }`, persists (`submissions.status`), logs `lead_status_changed { from, to }` with no lead content, and survives a reload; a failed `PATCH` rolls the select back with an alert; patching a lead of another session returns 404 and changes nothing; the view shows the hint "This is your PloyDB leads table." and no public route returns any lead. `[M]` + `[L]`
- [ ] AC-113 Next step: `LiveStep` shows the catalog's `next` primitives for the goal with the fixed copy of FR-48 (`inbound_leads`: Ploybooks reply drafts; `paid_growth`: connect an ad account, then a weekly Ploybook summary), each labeled "Coming soon"; a click logs one `next_clicked { goalType, primitive }` per primitive per mount and shows the thanks message; a primitive not in the goal's `next` returns 400; nothing else happens. `[M]` + `[L]`
- [ ] AC-114 Send a test lead (live, `inbound_leads`): the button on `LiveStep` creates one `submissions` row with the fixed content, `is_test = true`, `status 'new'`, `ip_hash` null; the leads view shows it with a "Test" badge and a changeable status; `test_lead_sent` is logged and `form_submitted` is not; the screen text says it is a test and nothing was sent anywhere; **`/metrics` counts and the verdict ignore it** (with zero real leads the verdict stays "No visits yet" or "visits_no_action" and `leads.total` is 0). `[M]` (UI and text) + `[L]` (row, `is_test`, badge, metrics exclusion)
- [ ] AC-115 Test lead guards: the 4th call returns 409 `limit`; a `paid_growth` session returns 409 `not_available` and the button is not rendered; an unpublished page returns 409 `not_published`; a request body with other content is ignored (the stored row is still the fixed one); unknown session 404, non-uuid 400. `[L]` (via `fetch`)
- [ ] AC-116 Public rate-limit and metrics queries filter `is_test = false` (code review) and a seeded mix of real and test leads produces counts, `conversion` and verdict from the real ones only. `[U]` + `[D]`

**Failure paths**
- [ ] AC-117 Publish failures: a failing publish route shows the alert with "Try again" and leaves the preview; a slug conflict is retried (AC-93). `[M]` (UI)
- [ ] AC-118 A failing metrics request shows the alert with "Try again" on `/metrics` and an inline retry on `LiveStep` while the URL stays visible; a failing leads request or test-lead request shows an inline alert and keeps the rest of the page; failing beacon requests change nothing for the visitor. `[M]`

**Explainability** (the reviewers pick parts at random)
- [ ] AC-119 You can explain, without notes:
  - what `publish` changes in the database and why it is safe to call twice;
  - why the page is cached but visits are counted by a beacon, and why published pages must be immutable;
  - why the public page has no image of ours, what the third-party logo hotlink exposes, and why the ad is not published;
  - how the form is validated against the stored definition, which abuse checks exist, and what they do not stop;
  - why submissions are framed as a PloyDB-style Leads table (typed columns, a status, write-only public access, owner read) and why test leads are flagged and excluded from metrics;
  - what the "Coming soon" next-step click records and why it is the conversion hook;
  - what "protected" means for `/metrics` without auth, and what a real fix would be;
  - why `SessionProvider` had to leave the root layout.

---

## 12. Open questions for the human (with recommended defaults)

1. **Is publishing final?** Default: yes (no unpublish, edit or delete); start over creates a new session. Alternative: an unpublish and "edit" loop, which means invalidating the cache and reworking regenerate.
2. **Metrics protection.** Default: the session uuid in `localStorage`, stated plainly in FR-47. Alternative: a separate random "owner token" returned at publish and required by the leads and metrics APIs (small change, slightly stronger) before any real auth. It matters more now that the leads view shows names and emails.
3. **Indexing.** Default: published pages are `noindex`. Alternative: indexable, which makes them real public websites and raises the stakes of the abuse protections.
4. **Visitor tracking and consent.** Default: anonymous random id in `localStorage`, no cookies, IP only as a keyed hash, no banner. Product or legal should confirm.
5. **Counting rules.** Default: owner visits and bots that run JavaScript count; the metrics page says so; test leads never count. Alternative: exclude visits from the owner's browser.
6. **Rate-limit numbers** (5 per 10 minutes per IP, 100 per hour per page, 30 events per minute) and the HMAC key reuse. Default as written; adjust after seeing real traffic.
7. **Slug style.** Default: `{business-name}-{4 random chars}` under `/p/`. Alternative: a custom slug input or a subdomain per page (needs DNS and a wildcard domain).
8. **Notify the owner of leads** (email, webhook). Default: none; leads are read on `/metrics`. (A reply draft is the Ploybooks "next" item, not built.)
9. **The `paid_growth` ad creative: published with the page or a private preview?** Default: private preview in M4, listed as a next item; only the page is public. Alternative: publish the ad text and image on a second public path (needs a public copy of the ad image, a new bucket and the caching rules of FR-43).
10. **Logo hotlinking on the public page.** Default: hotlink with a letter-avatar fallback (the site's host sees visitor IPs). Alternative: copy the logo into a public bucket at publish time.
11. **Copy** of the "You're live" screen, the verdict sentences, the funnel labels, the leads hint and the test-lead text is my wording; the canvas is not in the repo.
12. **The "Coming soon" next-step action** as the conversion hook, with fixed copy per primitive (FR-48). Default: as written, no pricing or paywall. Alternative: a "notify me" email capture (adds personal data and a table).
13. **Lead statuses** `new` and `contacted`, stored in `submissions.status`, with form values kept in `data` jsonb rather than real typed columns. Default: as written (simplest; the type of each column is its validator). Alternative: real columns, if a later CSV import or live template binding needs them.
14. **Test lead:** `inbound_leads` only, at most 3 per page, fixed fake content with an `@example.invalid` address, no public route involved. Default: as written. Alternative: also for `paid_growth`.

---

## 13. Working agreement with the coding agent

- Work in small steps and **stop after each**, summarizing the files changed and why:
  1. migration `0004`; `slug.ts`, `submission.ts`, `metrics.ts`, `leads.ts`, `ip-hash.ts` with unit tests (AC-93 green);
  2. layout isolation (`(app)` group, provider moved): M1, M2, M3 and M3B mocked suites green, `/p/x` and `/metrics` create no session (AC-91) before anything else is built;
  3. `POST /api/page/publish` + `SessionState.published` + Publish button + `LiveStep` (mocked tests, seeded tests);
  4. `/p/[slug]` with `'use cache'` (read the installed Cache Components docs first; check status 404 behavior with `next build`), headers in `next.config.ts`, renderer public mode (no image);
  5. `InquiryForm` + submit route + abuse checks (seeded tests, `x-forwarded-for` per test);
  6. beacon + event route, `TrackedCta`;
  7. metrics API + `/metrics` + LiveStep panel;
  8. leads: `GET` and `PATCH` routes + `leads-table.tsx` (AC-112), then the next-step panel and route (AC-113), then the test lead route and button (AC-114 to AC-116);
  9. mocked tests, the single paced live full-chain test, deploy, the deployed-URL run, and the manual cache check (AC-100).
- Do not run the live suite while another live run is in progress (shared model budget).
- Do not add libraries, abstractions or features beyond this spec; unpublish, editing, notifications, auth, ad publishing and any real Ploybooks or integration stay out even if they look easy.
- Verify Next.js 16 and AI SDK v7 APIs against the installed docs; `params` is async, `revalidateTag` needs a second argument, `updateTag` is Server Actions only.
- Keep appending to `NOTES.md` under "Milestone 4": decisions, human overrides, problems solved, per-AC results (same table style as M1 to M3), the cache check, and every `[D]` check done by hand. Finish by recording the whole-product run on the deployed URL (site, goal, page, publish, lead, test lead, metrics) for the Loom.
