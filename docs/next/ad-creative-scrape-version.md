> **NOT MVP: deferred to a later iteration.** On 2026-11-23 the MVP was re-scoped to three goals with one saved artifact each and no publishing; it is defined in `SPEC-M3.md`. This file was written for the previous plan, so parts of it are outdated (numbering, goal types, images, dependencies). It is kept as the starting point for the later iteration: the scrape-first ad-photo flow with an SSRF-guarded download (upload replaced it for the MVP).

# SPEC — Milestone 3B: "First win" part 1b, the `paid_growth` ad creative

Project: Ploy FTU (goal-first onboarding) · Take-home for Ploy
Milestone: 3B of 5 (M3, M3B, then M4) · Builds on: `SPEC-M2.md`, `SPEC-M3.md` (as written)
**Depends on (from M3, exactly):** a valid `page` row in `artifacts` for the session whose `goal_type` is `paid_growth` (one of the two available goals in `GOAL_CATALOG`, `src/lib/goals.ts`; custom goals are never a final goal in the MVP) with `meta.goalKey` equal to the session's current key (`goalKeyOf` in `src/lib/page/recipes.ts`); `deriveTheme` (`src/lib/page/theme.ts`); `PageDefinitionSchema`; `GET /api/sessions/[id]/page` and `SessionState.page`; `BuildStep` (`src/components/steps/build-step.tsx`); the edit to `POST /api/step/back` (FR-27); the unique index `artifacts_session_type_key` and the `artifacts_goal_type_valid` constraint from `0003`; the `playwright.unit.config.ts` / `test:unit` setup. From M1/M2: `researchSite` (`src/lib/tools/research-site.ts`), `normalizeUrl` (`src/lib/url.ts`), `clip()` (`src/lib/goals.ts`), `advanceStatus`, `logEvent`, the private `assets` bucket (`0001_init.sql`).
**Followed by:** `SPEC-M4.md` (publish). M3B adds no model request and no migration.
Design doc / canvas: not in the repo. Screens are specified by content and behavior only.

Numbering continues from M3: FR-29 to FR-38 and AC-65 to AC-87 are M3B's. Anything marked **(assumed)** is a decision made without a source in the repo; the open ones are in §12.

---

## 1. Goal

For a user whose goal resolves to `paid_growth`, add a second first win next to the landing page: **an ad creative**.

> The server picks one product photo from the user's own site with a fixed filter, stores a private copy, and asks an image model to place that product in an ad scene with a headline. If there is no usable photo, the user is on the no-website path, or fal fails, the user gets a **text-only branded ad card** instead: our own component, brand colors, business name, headline. The card is the always-works path and the default tested one.

Why a reference photo: an image model that has never seen the user's product invents one. With the real photo as a reference it keeps the product and changes only the scene.

### Where M3B stops (unambiguous)

- One `ad_creative` row per `paid_growth` session, and its stored images in the private `assets` bucket. `paid_growth` is the **only** goal that gets an ad (`inbound_leads` is the other available goal and gets none).
- The catalog's `next` for `paid_growth` is Integrations (connect an ad account), then a Ploybook weekly summary. Both are shown only as "coming soon" actions by M4's "You're live" screen; M3B builds neither.
- The reference photo comes **only** from the user's scraped site and the user **cannot change it**. No upload (§13 describes the next iteration), no choosing among photos, no editing the ad, no download button, no copy written by a model, no ad publishing or ad traffic.
- No model request: the ad's words are chosen by a deterministic rule. The only paid call is one fal image per generation.
- `sessions.status` stays `building`. The ad is never public; publishing is M4.

---

## 2. Tech stack (deltas only)

| Layer | Use | Notes |
| --- | --- | --- |
| Image model | **fal.ai** over plain `fetch` | New external service. **No new npm dependency**: `@fal-ai/client` and `@ai-sdk/fal` are not installed (verified: `node_modules/@fal-ai` does not exist) and `fetch` is enough for one endpoint. The model and request shape are **not chosen yet**: see §7. |
| Storage | Supabase Storage bucket `assets` (private, from M1) | Reference copy and generated ad image. No bucket change. |
| Scraping | `@mendable/firecrawl-js` 4.54.0, already installed | Two more formats on the existing single scrape call: no new request. |

New environment variables, server-only, added to `.env.example` **empty**: `FAL_KEY`, `FAL_MODEL_ID`. Optional test seam if §7 shows it is needed: `FAL_BASE_URL`. **Human action:** create the fal.ai account and key, put `FAL_KEY` and `FAL_MODEL_ID` in `.env.local` and in Vercel (all environments), then redeploy. The agent never asks for or prints the key. With either value empty the ad is the card (reason `no_key` / `no_model`), with no network call.

---

## 3. Verified facts about the repo and the Firecrawl SDK

- `artifacts.type` already allows `'ad_creative'`; `goal_type` is `not null`; `image_paths text[] default '{}'`. `0003` makes `(session_id, type)` unique, so one `page` and one `ad_creative` row per session can coexist.
- `assets` is a private bucket (`insert into storage.buckets ... false` in `0001_init.sql`), whose comment says it is for "uploaded product photos and copies of fal images".
- `researchSite` calls `firecrawl.scrape(url, { formats: ["branding", "markdown"], onlyMainContent: true, timeout })` and stores `content: { digest }`. The describe path stores `content: { description }`, with `url`, `name` and `brand` empty.
- `@mendable/firecrawl-js` 4.54.0 types (`dist/index.d.cts`): `FormatString` includes `"images"` and `"product"` (line 5); `Document.images?: string[]` (line 572) and `Document.product?: ProductProfile` (line 587), where `ProductProfile.variants[].images?: { url; alt? }[]` (lines 452 and 460); `BrandingProfile.images?: { logo?; favicon?; ogImage? }` (lines 392-395, all `string | null`); `DocumentMetadata.ogImage?: string` (line 522).
- **Uncertain, to be checked with one real scrape before relying on it** (the types and README do not say): (a) whether `onlyMainContent: true` filters the `images` list (likely, since the list is probably derived from the cleaned page; header and footer images would then be missing). `branding.images.ogImage` and `metadata.ogImage` come from meta tags and are expected to be unaffected. (b) What `product` returns on a page that is not a product page (expected: absent) and whether an extra format changes credits or latency. (c) Whether `images` entries can be relative or protocol-relative. The step-1 check records the answers in NOTES; if adding `product` costs noticeably more latency or credits, drop that tier (the ranking in FR-31 still works).
- `normalizeUrl` (`src/lib/url.ts`) checks the **hostname string** only (`PRIVATE_HOST` regex, `.local`, no-dot hosts). It does not resolve DNS, does not cover `100.64.0.0/10`, and says nothing about redirects. FR-32 adds what is missing.
- The `/api/onboarding` tool output carries `contentDigest` to the browser (M1 behavior). Candidate image URLs are stored in the DB only and are **not** added to `ResearchSiteOutput`.

---

## 4. Scope

### In scope
1. `researchSite` also stores candidate images; pure candidate collection and ranking.
2. Safe server-side download of the chosen photo (SSRF guard), private copy in `assets`.
3. fal call (config-driven), output copied into `assets`.
4. Deterministic ad copy; pure image-prompt builder.
5. `POST /api/ad/generate`; `ad` in `GET /api/sessions/[id]/page` and `SessionState`.
6. `AdCreative` component (image and text-only card), the "Your ad" section in `BuildStep`.
7. Cleanup on `building -> goal`; events; tests; deploy.

### Out of scope
Upload, photo choice, ad editing or download, model-written ad copy, other goals' ads, ad publishing, A/B, multiple formats or sizes, per-IP limits.

---

## 5. Functional requirements

### FR-29 The `ad_creative` artifact
`src/lib/ad/schema.ts` (pure, no `server-only`): `AdCreativeSchema`, stored in `artifacts.data` for `type = 'ad_creative'`, `goal_type = 'paid_growth'`.

```ts
type AdImageReason =
  | "no_website" | "no_key" | "no_model" | "no_reference" | "reference_failed"
  | "timeout" | "rate_limited" | "blocked" | "bad_response" | "output_failed" | "upload_failed" | "unknown";

type AdCreativeData = {
  version: 1;
  kind: "card" | "image";
  businessName: string;                  // <= 80
  headline: string;                      // <= 60
  headlineSource: "site" | "name" | "description";
  logoUrl: string | null;                // https only
  theme: { primary: string; onPrimary: string };   // deriveTheme(brand)
  adImagePath: string | null;            // bucket-relative; set iff kind === "image"
  referenceSource: "scraped" | "upload" | null;     // "upload" is reserved for §13
  imageReason?: AdImageReason;           // why kind is "card" (set whenever kind === "card")
  imagePrompt?: string;                  // for explainability only
  goalKey: string;                       // same key as the page
  generation: number;                    // 1, 2, 3
  generatedAt: string;
};
```
- `image_paths` lists **every object stored for this ad**: the generated image (if any) and the reference copy (if any). `data.adImagePath` says which one the preview shows. fal URLs are never stored in `data`, `image_paths`, events or any response.
- Storage layout in `assets`: `{sessionId}/ad/reference.{ext}` and `{sessionId}/ad/ad-{generation}.{ext}`. The whole `{sessionId}/ad/` prefix belongs to M3B (cleanup removes it); the next iteration puts uploads under `{sessionId}/upload/`.
- Validated with `AdCreativeSchema` before every write and before render.

### FR-30 Candidate images in `researchSite`
- Edit the scrape to `formats: ["branding", "markdown", "images", "product"]` (keep `onlyMainContent: true`; changing it is out of scope and the limitation is recorded in §3). No new request.
- Pure `collectCandidates({ pageUrl, product, ogImages, images, logo, favicon })` in `src/lib/ad/candidates.ts` returns `{ url: string; source: "product" | "og" | "page"; alt?: string }[]`: product variant images first (document order), then `branding.images.ogImage` and `metadata.ogImage`, then `doc.images`. Each URL is resolved against `pageUrl` with `new URL`; non-`https:` results are dropped; query-less duplicates are removed; the logo, the favicon and `brand.logoUrl` are removed; the list is capped at 20 and each URL at 500 characters.
- The upsert becomes `content: { digest, images }` (an empty array when none). `research_done` gains `images: <count>`. Nothing about images is added to the tool output, `SessionState` or any response.
- The describe path stores no images.

### FR-31 Reference-photo choice (`src/lib/ad/choose.ts`, pure, no model)
`chooseReferences(candidates, max = 3)` returns up to 3 candidates in the order to try. **Drop** a candidate if any of: the URL path has an extension other than `.jpg`, `.jpeg`, `.png`, `.webp` (extensionless CDN URLs are kept: the real type is checked at download); the path or file name matches `/logo|icon|favicon|sprite|avatar|badge|pixel|tracking|spacer|blank|placeholder|arrow|button/i`; a size hint says it is small (a `w=`/`width=` query value, or `-WxH` / `_WxH` in the file name, with the smaller side under 400). **Rank**: tier `product` before `og` before `page`; within a tier, a larger size hint first, then document order. "Largest plausible" is therefore decided from URL hints only; the real floor is the download check (FR-32: at least 15 KB). The user cannot change the choice. `chooseReferences` takes stored candidates and returns paths-to-try; the next stage takes **a stored image path**, whatever its source (§13).

### FR-32 Safe download and private copy (`src/lib/ad/fetch-image.ts`, `server-only`)
`fetchImageSafely(url, { maxBytes = 8 MB, minBytes = 15 KB, timeoutMs })` returns `{ ok: true; bytes; type: "jpeg" | "png" | "webp" } | { ok: false; reason }`; never throws. Used for the scraped photo **and** for fal's output URL.
1. `https:` only. `normalizeUrl` must accept the URL (blocks private hostnames).
2. **Resolve the host** with `node:dns/promises` `lookup(host, { all: true })` and reject if **any** address is private, loopback, link-local, CGNAT (`100.64.0.0/10`), unspecified, multicast, or an IPv4-mapped IPv6 form of those. The check is `isPrivateIp(ip)`, a pure function added to `src/lib/url.ts` and unit-tested. Reason: `normalizeUrl` only sees the hostname string, so `anything.attacker.com` resolving to `127.0.0.1` would pass it.
3. `fetch` with `redirect: "manual"`; follow at most 3 redirects, re-running steps 1 and 2 on every hop; one `AbortSignal.timeout` for the whole fetch; no cookies, a generic `User-Agent`.
4. The response `content-type` must be `image/jpeg`, `image/png` or `image/webp` **before** the body is read. Read the body as a stream and abort past `maxBytes` (do not trust `content-length`). Reject under `minBytes` (tracking pixels, icons).
5. **Magic bytes** (`sniffImageType(bytes)`, pure, `src/lib/ad/sniff.ts`): JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`. The sniffed type must match the header; the sniffed type decides the extension and the stored `contentType`.
- **Residual risk, accepted for the MVP and stated:** DNS rebinding between the lookup and the connection is not closed (pinning the resolved IP needs a custom dispatcher, which would add a dependency). It is limited by https-only, by the response having to be a valid image under 8 MB, and by the stored bytes being shown only to the same user.
- The copy: `supabaseAdmin().storage.from("assets").upload(path, bytes, { contentType, upsert: true })` at `{sessionId}/ad/reference.{ext}`. fal receives a **signed URL of this copy** (`createSignedUrl(path, ttl)`, the ttl at least the fal job's budget, set from §7), never the original site URL.

### FR-33 fal generation (`src/lib/ad/fal-client.ts` and the env-reading orchestration)
- `generateAdImage({ key, modelId, baseUrl, referenceUrl, prompt })` in `fal-client.ts` returns `{ ok: true; imageUrl; contentType? } | { ok: false; reason: FalFailureReason }` with `FalFailureReason = "timeout" | "rate_limited" | "blocked" | "bad_response" | "unknown"`; never throws. **Exception to the "files touching secrets import `server-only`" rule, on purpose:** this file receives the key as an argument, reads no env and imports no server module, so a unit test can run it against a local `node:http` stub; the env-reading caller `generate-ad.ts` imports `server-only`. Nothing under `src/components` may import it (AC-66).
- The caller reads `FAL_KEY`, `FAL_MODEL_ID` (and `FAL_BASE_URL` if kept). Empty `FAL_KEY` gives `no_key`, empty `FAL_MODEL_ID` gives `no_model`, both before any network call. HTTP 429 gives `rate_limited`, a refusal or empty result `blocked` or `bad_response`, a timeout `timeout`; 401 or 403 gives `unknown` with the detail only in `tool_failed.detail`.
- fal's output URL is passed through `fetchImageSafely` (FR-32) and copied to `{sessionId}/ad/ad-{generation}.{ext}`. A failed download is `output_failed`, a failed upload `upload_failed`. **The fal URL is never stored or shown**; it may expire.
- **The request and response shape is §7 and is not guessed here.**

### FR-34 Ad copy and prompt (pure, no model)
- `buildAdCopy(profile)` in `src/lib/ad/copy.ts`. **Only text the site actually says, or just the business name. Never an invented offer.**
  - `businessName` = `profile.name`, else `brand.name`, else the domain, else (describe path) `clip(first sentence of description, 60)`, else "Your business".
  - `headline`: scan the digest's markdown headings (`#` to `###`), with markdown escapes removed; take the first that is 3 to 60 characters, is not the business name, is not navigation text (`/^(home|about|contact|menu|shop|blog|log ?in|sign ?in|cart|search)\b/i`), and contains no offer or claim word (`/%|\$|€|£|\b(off|free|sale|discount|deals?|save|coupon|promo|limited|best|guarantee|#1)\b/i`). It is used whole, never clipped (`headlineSource: "site"`). Otherwise the headline is the business name (`"name"`), or for the describe path `clip(description, 60)` (`"description"`).
  - Property to test: the headline is a verbatim line of the digest, the business name, or a clip of the description. It never contains a number the profile lacks.
- `buildImagePrompt({ name, summary, description, headline, primary })` in `src/lib/ad/prompt.ts` (**pure and unit-tested; there is no `category`**). The "about" text is `summary`, else `name`, else `clip(description, 100)`, with control characters, braces, backticks, newlines and double quotes removed. A fixed template says: a square social ad for {about}; use the product from the reference image exactly as it appears and do not redraw it; place it in a clean, well-lit scene that suits the business with {primary} as the accent color; render exactly this headline once, spelled exactly: "{headline}"; no other text, no logos, no prices, no discounts, no watermark. The model never writes the prompt. The exact wording of the reference-image instruction is finalized after §7. If the chosen model garbles the headline in the one real test, the fallback design is to ask for **no** text and overlay `headline` in our component; the artifact shape does not change.

### FR-35 Route `POST /api/ad/generate` (`src/app/api/ad/generate/route.ts`)
- Body (Zod): `{ sessionId: uuid, regenerate?: boolean }`; invalid 400.
- Guards, in order: session not found 404; `status !== 'building'` 409 `{ error: "wrong_step" }`; no valid page for the current goal 409 `{ error: "no_page" }`; page `goal_type !== 'paid_growth'` 409 `{ error: "not_paid_growth" }`; a valid saved ad (same `goalKey`) and `regenerate` not true returns it (`source: "saved"`) with no fal call; `regenerate` and `generation >= 3` returns `{ ok: false, reason: "regen_limit" }` (**assumed** cap: fal costs money).
- `generateAd()` (`src/lib/ad/generate-ad.ts`, `server-only`), under one overall deadline (`AbortSignal.timeout(55_000)`; anything past it becomes a card with `timeout`):
  1. Load profile (including `content.images`), brand, the page's theme and the existing `ad_creative` row (remember its `id`).
  2. `buildAdCopy`, `deriveTheme`. Decide `kind` in this order, stopping at the first failure with a card and that reason: profile has no `url` (`no_website`); `FAL_KEY` empty (`no_key`); `FAL_MODEL_ID` empty (`no_model`); no candidate survives `chooseReferences` (`no_reference`); reference download fails on all tried candidates, unless a stored reference copy already exists from an earlier generation, which is **reused** (`reference_failed`); fal fails (its reason); output download or upload fails.
  3. On success `kind: "image"`, `adImagePath` set, `imageReason` absent.
  4. **Save safely**, as in M3 FR-23: re-read `sessions.status` (not `building` means 409 `wrong_step`, and the objects uploaded so far are removed); upsert on `(session_id, 'ad_creative')` with `goal_type: 'paid_growth'`, `data`, `image_paths`, sending `id` **only** if one was found in step 1; re-read the status again and, if it changed, delete the row and remove `{sessionId}/ad/` objects and return 409. After a successful regenerate, remove the previous `ad-{n}` object (not the reference). If the upsert fails after uploads, remove what was uploaded.
- `export const maxDuration = 60`.
- Response (HTTP 200 after the guards): `{ ok: true; source: "generated" | "saved"; artifactId; ad: AdCreativeData; imageUrl: string | null } | { ok: false; reason: "regen_limit" | "unknown" }`. `imageUrl` is a 1-hour signed URL minted for this response, or null.
- Events: `ad_generated { kind, headlineSource, reason?, referenceSource?, regenerate, generation, falMs?, ms }` (no `falMs` when fal was not called); `tool_failed { tool: "generateAd", reason, detail? }` for every reason except `no_website` and `no_reference` (expected, not failures).

### FR-36 Preview data
- `GET /api/sessions/[id]/page` (M3) gains `ad: null | { artifactId: string; data: AdCreativeData; imageUrl: string | null }`. The ad is returned only if its `goalKey` matches the current key; `imageUrl` is `createSignedUrl(adImagePath, 3600)` or null on failure. M3's `{ artifactId, page }` fields are unchanged.
- `SessionState` gains `ad: null | { artifactId: string; kind: "card" | "image"; generation: number }`, filled by `loadSessionState` with the same key check, so `BuildStep` knows whether to ask for an ad.

### FR-37 Ad UI
- `src/components/page/ad-creative.tsx`, props `{ ad: AdCreativeData; imageUrl: string | null }`, no server imports.
  - **Text-only card (the default path):** a square (`aspect-ratio: 1`) block on `theme.primary` with `onPrimary` text: the logo (https only, `referrerPolicy="no-referrer"`, letter avatar on error or null), the `headline` large, the business name small, and a decorative pill "Learn more" (`aria-hidden`, not a button). All text is React text; colors pass the same hex check as M3's renderer.
  - **Image:** `<img src={imageUrl}>` with `alt` = "{businessName}: {headline}". On load error it asks the parent to refetch the preview **once** (signed URL expired in a long-open tab); if it fails again it shows the card.
- `BuildStep` (M3) when the page is ready **and** `page.goalType === "paid_growth"`: a second section below the page preview, `role="region" aria-label="Ad preview"`, heading "Your ad", and a line "If your site has a product photo, we send it to our image provider to make the ad." If `state.ad` is set, fetch it with the preview (no request to `/api/ad/generate`); otherwise call it **once, after the page is ready**, sharing one in-flight request per session (Strict Mode). The page preview never waits for the ad. Other goals render no ad section and make no ad request.
  - Loading: `role="status"` "Making your ad…" with "Up to 45 seconds when we use your photo." within 1 s.
  - Notes under the ad (each only when true): `image`: "Made from a photo on your site."; `no_website`: "Add a website to turn a product photo into an ad. Here is a simple branded ad for now."; `no_reference`: "We didn't find a usable product photo on your site, so this ad is text-only."; `no_key` or `no_model`: "Image ads aren't available right now, so this ad is text-only."; any other reason: "We couldn't create the ad image, so here is a text-only ad. Regenerate to try again."
  - `Regenerate ad` (pill, own pending state, disabled at the cap with "You've reached the regenerate limit for the ad"). The old ad stays visible until the new one arrives. A failure shows an inline `role="alert"` "We couldn't make your ad." with "Try again"; it never affects the page preview, and the page's own Regenerate does not touch the ad.

### FR-38 Back, cleanup, events
- `POST /api/step/back`, `building -> goal` (extends M3 FR-27, same order: **status first, deletes second**, all best-effort): also delete the session's `ad_creative` row, and remove every object under `{sessionId}/ad/` (`storage.from("assets").list(...)` then `remove(...)`; the prefix, not `image_paths`, so an orphan from a crash is also cleared). Log `ad_discarded { had_image }` only when a row was deleted. The goal key keeps a leftover row harmless.
- Extend `EventName`: `ad_generated`, `ad_discarded`. `research_done` gets the extra `images` prop (additive).

---

## 6. Data model deltas

**None.** No migration: `ad_creative` is allowed by the `0001` check, `artifacts_goal_type_valid` and the unique index come from `0003`, and the `assets` bucket exists.

---

## 7. fal model and request shape (from fal's public docs; verify with one real call)

> **Status:** every value below comes from fal's public documentation (research recorded in `NOTES.md`, "fal.ai model research for the M3B ad image"). **None of it has been confirmed by a real call.** Before writing the client, make **one real call** with the human's `FAL_KEY` (the human runs it or approves running it) and record the request, the response, the timing and the cost in `NOTES.md`. Where this table says "verify", the real call must settle it. Do not guess anything the table does not state.

| # | Item | Value (source: fal docs unless marked) | Verify with the real call |
| --- | --- | --- | --- |
| 1 | `FAL_MODEL_ID` and backup | Primary `google/nano-banana-2.1/edit` (newest; tagged typography; multi-reference). Backup `fal-ai/nano-banana-2/edit` (older, stable, same schema family). Alternative from another vendor: `openai/gpt-image-2.5/flare/edit` (reviews rate GPT image models best on text; use `quality: "medium"`; latency unknown). `flux-pro/kontext` is weakest on text and is not a candidate. | Is 2.1 stable? If not, use the backup. |
| 2 | Host, sync vs queue | **Queue**: `POST https://queue.fal.run/<endpoint id>` returns `request_id`, `status_url`, `response_url`; poll `status_url` (202 while queued or running, 200 when done; a failed request also reports COMPLETED); `GET response_url`. Poll every 1 to 2 s, **give up at about 45 s** (inside the 55 s deadline). The queue retries 503/504 up to 10 times (`X-Fal-No-Retry: 1` disables). Sync `https://fal.run/...` is simpler but has no retry. Queue results are kept 1 hour (6 minutes if 10 KB or larger), so fetch the result right away. | Real latency; that polling works from a serverless function. |
| 3 | Auth header | `Authorization: Key $FAL_KEY`; the key needs the `API` scope. | 401 body shape. |
| 4 | Request fields | `prompt`; **`image_urls`** (array, up to 14; public URL or base64 data URI); `num_images: 1`; `aspect_ratio` (includes `1:1`, `4:5`, `16:9`; **no 1.91:1**, so use `1:1` and crop if a wide ad is needed); `resolution: "1K"`; `output_format: "jpeg"`; `safety_tolerance` ("1" strictest to "6", default "4"); `seed`; `thinking_level`. | Exact field names and accepted values on 2.1. |
| 5 | Response fields | `images: [{ url, content_type, file_name, file_size, width, height }]` and `description`. A returned `seed` or timing field was not found for this model family. How a safety refusal or an empty result is reported is **not documented** in what was read. | Refusal status code and body; that `width` and `height` are present. |
| 6 | Output URL lifetime and host | Generated media is available **at least 7 days by default** (configurable per request with the `X-Fal-Object-Lifecycle-Preference` header), then permanently deleted. Copying into `assets` is still required (and the brief asks for it). The output host is not stated. | The output URL host (decides whether `fetchImageSafely` needs a host allowlist) and its `Expires` headers. |
| 7 | Price per image | About **$0.04 to 0.06** at 1K for the primary (token-billed; the cost with an input image is not stated, so this is an estimate). Backup `nano-banana-2/edit`: $0.08 at 1K. With the cap of 3 generations per session, the worst case is about **$0.12 to 0.24 per session**. | Real billed cost (dashboard or the `X-Fal-Billable-Units` header). |
| 8 | Latency | **No numbers documented** for these models. Plan for a normal result in well under 30 s and keep the 45 s give-up. | Typical and worst case at 1K, several runs. |
| 9 | Concurrency and 429 | New accounts start at **2 concurrent requests** (rises with credit purchases). On the sync API, going over returns **429** with `type: concurrent_requests_limit`; the queue accepts and queues the excess. | That our usage never hits it; the 429 body. |
| 10 | Signed URL as reference | Presigned S3/GCS/R2-style URLs are accepted if reachable **without extra auth headers**; fal fetches them asynchronously, so give the URL **at least a few minutes** (use the spec's ttl, minimum 5 minutes). A Supabase signed URL should qualify. | That a Supabase signed URL is accepted. |
| 11 | Error body shapes | 404: result expired. 422: model input error, `detail` is a list of `{ loc, msg, type }`. 503: runner error. 504: timeout. Pipeline errors: `{ detail, error_type }`. Billing: requests are rejected when the prepaid balance falls below a lock threshold (code and body for 401 and 402 are not documented in what was read). | 401, 402 and refusal bodies. |
| 12 | Headline spelling and product fidelity | **Not established.** The evidence for text quality and for keeping the real product recognizable is reviews and vendor tests, not fal's pages, and no source guarantees correct spelling. | Run **5 or more** generations on real product photos: is the headline spelled correctly, does the product stay recognizable, what happens to text already on the product. This decides text-in-image vs our own overlay (FR-34). |
| 13 | `FAL_BASE_URL` seam | fal does not require it. **Keep it as an optional env var** so the unit test can point `fal-client.ts` at a stub server (the real API must not be called in tests). | none |

A plain `fetch` implementation is enough (one POST, a poll loop, one GET); do **not** add `@fal-ai/client`. Keep `FAL_KEY` server-side only.

---

## 8. Project structure deltas

```
ploy-ftu/
├─ SPEC-M3B.md
├─ e2e/
│  ├─ ad-lib.unit.spec.ts                  # new: pure modules (+ fal-client against a stub after §7)
│  ├─ ad.mocked.spec.ts                    # new
│  ├─ ad.live.spec.ts                      # new
│  └─ helpers.ts                           # extended: fixtureAd, ad routes in fakeBackend, seed ad/candidates
└─ src/
   ├─ app/api/ad/generate/route.ts         # POST
   ├─ components/page/ad-creative.tsx      # card + image
   └─ lib/
      ├─ ad/schema.ts                      # PURE: AdCreativeSchema, types
      ├─ ad/candidates.ts                  # PURE: collectCandidates
      ├─ ad/choose.ts                      # PURE: chooseReferences
      ├─ ad/sniff.ts                       # PURE: sniffImageType
      ├─ ad/copy.ts                        # PURE: buildAdCopy
      ├─ ad/prompt.ts                      # PURE: buildImagePrompt
      ├─ ad/fal-client.ts                  # no env, no server imports (FR-33)
      ├─ ad/fetch-image.ts                 # server-only
      ├─ ad/generate-ad.ts                 # server-only: orchestration, reads FAL_*
      ├─ url.ts                            # + isPrivateIp (pure)
      ├─ tools/research-site.ts            # + formats, content.images
      ├─ session-state.ts                  # loadSessionState adds `ad`
      └─ events.ts                         # + 2 event names
```
Edits: `src/app/api/step/back/route.ts` (FR-38), `src/app/api/sessions/[id]/page/route.ts` (FR-36), `src/components/steps/build-step.tsx` (FR-37), `src/lib/goals.ts` (`SessionState.ad`), `.env.example`, `package.json` (no change expected).

Placement rule (from M3): every pure function a unit test imports lives in a file without `server-only`. Files that read `FAL_*` or the service role import `"server-only"`; `fal-client.ts` is the one documented exception (FR-33).

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Feedback | The "Making your ad…" status within **1 s**; the page preview is never blocked by the ad. |
| Latency | Overall deadline 55 s, `maxDuration = 60`; the card path (no fal) returns in **under 2 s**. fal's own budget comes from §7. |
| Resilience | Any failure yields a card, HTTP 200; a failed ad never changes the page; saved ads are reused on refresh and retry. |
| Security | Scraped URLs are untrusted: https only, hostname **and** resolved-IP checks on every hop, type allowlist by header and magic bytes, 8 MB cap, timeout; fal sees only a signed URL of our copy; no fal URL stored; `FAL_KEY` server-side only; bucket stays private; ad text is never invented and never from a model; the model-free copy rule removes prompt injection from the ad. |
| Cost | No model request. At most 3 fal images per ad row (price from §7); the card path costs nothing. |
| Privacy | The user's site photo is sent to fal; the UI says so (FR-37). |
| Accessibility | Ad region labelled; image alt = name and headline; card contrast >= 4.5:1 via `deriveTheme`. |

---

## 10. Testing strategy

Default tested path: the **text-only card**. Almost nothing spends fal credits.

- **Unit** (`npm run test:unit`, no server): `collectCandidates`, `chooseReferences`, `sniffImageType`, `isPrivateIp`, `buildAdCopy`, `buildImagePrompt`; after §7 is filled, `fal-client.ts` against a local `node:http` stub (success, 429, refusal, timeout, malformed body), which spends no credits.
- **Mocked** (`ad.mocked.spec.ts`, no fal, no model): `fakeBackend` gains `**/api/ad/generate` and the `ad` field of the preview route; the signed image is a route-fulfilled 1x1 PNG. M3's mocked tests for a `paid_growth` page need that default ad route, or `BuildStep` would call the real server.
- **Live** (`ad.live.spec.ts`, 30 s `afterEach` pause): seeds a `building` session with a profile and a `page` artifact from `fixturePage("paid_growth")`, so no model request is spent. Card-path tests spend nothing (seeded profile without images; the describe-path profile; seeded private-host candidates). **One test spends one fal image**: seeded `content.images` with an https product photo chosen by the human (any public jpeg or png they control; `http://localhost` is rejected by the guard, so local runs also need an https image). Empty-`FAL_KEY` and invalid-key paths are checked locally (an invalid key spends nothing) and recorded in NOTES; the deployed run exercises only the success path once. `E2E_BASE_URL` points the suite at Vercel.

---

## 11. Acceptance criteria

Everything must pass **on the deployed Vercel URL**. `[U]` unit, `[M]` mocked, `[L]` live, `[D]` manual or DB check.

**Build, config, research**
- [ ] AC-65 `npm run build` and `npm run lint` pass; M1, M2 and M3 mocked suites pass (M3 `paid_growth` tests get the default ad route); `test:unit` passes. `[D]`
- [ ] AC-66 `.env.example` lists `FAL_KEY` and `FAL_MODEL_ID` (empty); `git diff package.json` has no dependency change and no `@fal-ai` package exists; `FAL_KEY` is set in Vercel and absent from `.next/static` and every browser response; `generate-ad.ts` and `fetch-image.ts` import `"server-only"`; `rg "fal-client" src/components` and `rg "server-only" src/lib/ad/{schema,candidates,choose,sniff,copy,prompt}.ts` find nothing. `[D]`
- [ ] AC-67 §7 is fully filled and one real fal call is recorded in NOTES (request, response, latency, cost, headline spelling) **before** `fal-client.ts` exists. `[D]`
- [ ] AC-68 A live research of a real site stores `content.images` (an array, possibly empty), `research_done.props.images` matches its length, the tool output and `SessionState` contain no image URL, and the answers to §3's three uncertainties are recorded in NOTES. `[L]` + `[D]`

**Pure logic**
- [ ] AC-69 `collectCandidates` / `chooseReferences`: relative URLs resolve; `http:`, `.svg`, `.gif`, `.ico`, logo, favicon, `sprite`, `icon` and small-hint URLs are dropped; order is product, then og, then page; at most 20 stored and 3 tried; an empty input gives `[]`. `[U]`
- [ ] AC-70 `sniffImageType` accepts real JPEG, PNG and WebP headers and rejects HTML, a PNG header on JPEG bytes, truncated input; `isPrivateIp` is true for `127.0.0.1`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `::1`, `fc00::1`, `fe80::1`, `::ffff:127.0.0.1` and false for public addresses. `[U]`
- [ ] AC-71 `buildAdCopy`: picks the first clean heading verbatim; skips navigation text, offer words (`50% off`, `Free delivery`) and lines over 60 characters; falls back to the business name, then (describe path) to a clip of the description; the headline is always a digest line, the name, or a description clip. `[U]`
- [ ] AC-72 `buildImagePrompt`: strips control characters, braces, backticks and double quotes; uses `summary`, else name, else description; contains the headline once; ends with the no-other-text suffix; has no `category`. `[U]`

**Happy path**
- [ ] AC-73 A `paid_growth` page ready in `BuildStep` shows the "Ad preview" region (loading, then the ad) while the page preview is already visible; any other goal shows no ad section and makes **zero** `/api/ad/generate` requests. `[M]`
- [ ] AC-74 Card path: a seeded profile without usable images yields one `ad_creative` row with `kind "card"`, `imageReason "no_reference"`, `adImagePath` null, empty `image_paths`, no fal call (`ad_generated` has no `falMs`), `goal_type 'paid_growth'`, `sessions.status` still `building`, in under 2 s; the card shows the business name and headline in brand colors. `[L]` + `[M]`
- [ ] AC-75 No-website path: a describe-path profile yields a card with `imageReason "no_website"`, the headline from the description or "Your business", and the matching note. `[L]` + `[M]`
- [ ] AC-76 Image path (spends one fal image): `kind "image"`; the reference copy and the ad image both exist under `{sessionId}/ad/` in `assets` and are listed in `image_paths`; the preview shows the ad through a signed URL; both objects are **not** readable through the public object URL; no fal host appears in `data`, `image_paths`, events or any response; the headline spelling and product fidelity are judged by eye and written in NOTES. `[L]` + `[D]`
- [ ] AC-77 Refreshing with a saved ad shows it with **zero** `/api/ad/generate` requests and no new `ad_generated`. `[M]` + `[L]`
- [ ] AC-78 Regenerate ad keeps the same `artifactId`, increments `generation`, removes the previous `ad-{n}` object after saving, **reuses** the stored reference (no second download), keeps the old ad if the new attempt fails, and the 4th returns `regen_limit` (seed `generation = 3`). The page's Regenerate does not touch the ad and an ad failure leaves the page unchanged. `[M]` + `[L]`

**Security**
- [ ] AC-79 Seeded candidates `https://127.0.0.1/a.png`, `https://localhost/a.png`, `http://example.com/a.jpg`, a `.svg`, and a public hostname that resolves to a private address (a wildcard-DNS name such as `localtest.me`, recorded in NOTES) all end in a card (`reference_failed` or `no_reference`), with no fal call and nothing stored under `{sessionId}/ad/`. `[L]`
- [ ] AC-80 The ad never invents text: for seeded profiles, `data.headline` is a verbatim digest line, equals `businessName`, or is a clip of the description; none contains an offer or claim word. `[U]` + `[L]` (DB check)

**Failure paths and guards**
- [ ] AC-81 Guards: unknown session 404; non-uuid 400; status other than `building` 409 `wrong_step`; no page 409 `no_page`; a non-`paid_growth` page 409 `not_paid_growth`. A generate call racing `POST /api/step/back` ends, in either order, with **no** `ad_creative` row and no `{sessionId}/ad/` objects if the status is `goal` (run a few times). `[L]`
- [ ] AC-82 With `FAL_KEY` empty, `FAL_MODEL_ID` empty, or an invalid key, the response is HTTP 200 with a card, the right `imageReason` and (for the invalid key) a `tool_failed { tool: "generateAd" }` event; empty values make no network call. `[D]` (local run, no credits) + `[M]` (notes per reason)
- [ ] AC-83 UI: each reason shows its note; an error or a 55 s stall shows the ad alert with "Try again" and leaves the page; an expired image URL triggers one refetch and then the card. `[M]`
- [ ] AC-84 "Change my goal" deletes the page and ad rows and removes every object under `{sessionId}/ad/`, logs `ad_discarded`, and sets status `goal`; choosing another goal builds fresh artifacts. `[L]`

**Explainability**
- [ ] AC-85 You can explain, without notes: why the reference photo is chosen by a deterministic filter and not a model, and what the filter drops.
- [ ] AC-86 You can explain, without notes: the SSRF layers (https, hostname check, resolved-IP check on every redirect hop, header plus magic-byte type check, size and time caps) and the residual DNS-rebinding risk.
- [ ] AC-87 You can explain, without notes: why fal sees a signed URL of our copy, why fal outputs are copied into private storage and fal URLs are never stored, why the text-only card is the default path, and why no model writes the ad text.

---

## 12. Open questions for the human (with recommended defaults)

1. **fal model, price and latency** come from §7. Default: do not start coding until §7 is filled and one real call is recorded; confirm the cost tolerance (cap of 3 images per ad row).
2. **Auto-generate the ad when `paid_growth` reaches `building`** (spends fal credits for every such session that has a photo) or show a "Create my ad" button. Default: auto, because the first win should appear without another click.
3. **Disclosure line** about sending the photo to the image provider (FR-37). Default: show it.
4. **Headline rule**: the first clean heading from the site, else the business name. Alternative: always the business name (even safer, duller). Default: as specified.
5. **Card is preview-only** (no download or share; a user can screenshot). Default: yes for M3B; a "save as image" step is a later option.

---

## 13. Next iteration (listed, not built): scrape first, upload as fallback

Covers every case the MVP leaves out: sites with no usable photo and the no-website path. Estimated 30 to 45 minutes. It would involve:
- An upload screen in `BuildStep`'s ad section (shown when `imageReason` is `no_reference`, `no_website` or `reference_failed`): a file input accepting JPEG, PNG and WebP, a size hint, a preview of the chosen file.
- `POST /api/ad/upload-url` returning a **signed upload URL** (`createSignedUploadUrl`) for `{sessionId}/upload/{uuid}.{ext}`; the browser uploads straight to Storage (a function body limit would otherwise cap the file size). A second call confirms the upload; the server then reads the object back, applies the same size cap and `sniffImageType`, deletes it if invalid, and records the path.
- `generateAd` already takes **a stored image path** as the reference, whatever its source: it would prefer an uploaded path (`referenceSource: "upload"`, already in the schema) over the scraped candidates. Nothing in M3B's artifact shape, cleanup (uploads live outside `{sessionId}/ad/`) or events needs to change.
- Tests: the unit tests for size and magic bytes are reused; a mocked upload flow; one live upload.

---

## 14. Working agreement with the coding agent

Work in small steps and **stop after each**, summarizing the files changed and why:
1. Fill §7: research with the human, **one real fal call**, record it in NOTES. No product code yet.
2. Pure modules and unit tests: `schema.ts`, `candidates.ts`, `choose.ts`, `sniff.ts`, `copy.ts`, `prompt.ts`, `isPrivateIp` (AC-69 to AC-72, AC-80 unit part green first).
3. `AdCreative` component + `fixtureAd` + mocked tests for the card and the image (no backend).
4. `researchSite` change (AC-68): run one live scrape and record the three uncertainties from §3.
5. `fetch-image.ts` and `fal-client.ts` (stub-server unit test), then `generate-ad.ts` and `/api/ad/generate`, the `GET` page and `SessionState` additions. Test the card path with `curl` against a seeded session; the first real image **once**, with the human's key.
6. `BuildStep` ad section, the `step/back` cleanup, remaining mocked tests.
7. Paced live tests, deploy, the deployed-URL run.

Do not run the live suite while another live run is in progress (shared fal credits and rate limit). Do not add libraries or features beyond this spec (no upload, no choosing a photo, no download button even if it looks easy). Verify Firecrawl, AI SDK and Next.js 16 APIs against the installed packages (`node_modules/@mendable/firecrawl-js/dist/index.d.cts`, `node_modules/next/dist/docs/`; route `params` is a Promise). Append to `NOTES.md` under "Milestone 3B": decisions, overrides, problems, the §7 call, per-AC results in the M1/M2 table style, every `[D]` check done by hand.
