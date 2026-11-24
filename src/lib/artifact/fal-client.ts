// A small client for fal.ai's queue API over plain `fetch` (no SDK). Pure: it takes its config as an argument and never reads the
// environment or imports server-only code, so it can be tested against a stub server (the real API is never called in tests).
// The config's `key` is only ever sent as the Authorization header and is scrubbed from any error detail.

export type FalConfig = { baseUrl: string; key: string; model: string };

export type FalFailure = "billing" | "unauthorized" | "rate_limited" | "blocked" | "timeout" | "unavailable" | "bad_response" | "unknown";
export type FalResult =
  | { ok: true; imageUrl: string; contentType: string | null }
  | { ok: false; reason: FalFailure; status?: number; detail?: string };

type Http = { status: number; ok: boolean; text: string; json: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What an error status and body from fal mean to us. */
export function mapFalError(status: number, detail: string): FalFailure {
  if (status === 401) return "unauthorized";
  if (status === 402) return "billing";
  if (status === 403) return /balance|locked|billing|top up/i.test(detail) ? "billing" : "unauthorized";
  if (status === 422) return /safety|policy|nsfw|content/i.test(detail) ? "blocked" : "unknown";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

/**
 * Make one ad image: submit to the queue, poll until it completes (or `deadlineMs` runs out), read the result.
 * Never throws: every failure is a typed reason, so the caller can fall back to the text-only card.
 */
export async function generateAdImage(
  cfg: FalConfig,
  opts: { prompt: string; referenceUrl: string; deadlineMs?: number; pollMs?: number },
): Promise<FalResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const pollMs = opts.pollMs ?? 1_500;
  const scrub = (s: string) => s.split(cfg.key).join("[key]").replace(/\s+/g, " ").slice(0, 200);
  const fail = (reason: FalFailure, status?: number, detail?: string): FalResult => ({
    ok: false,
    reason,
    status,
    detail: detail === undefined ? undefined : scrub(detail),
  });

  const call = async (url: string, init: RequestInit): Promise<Http | FalResult> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail("timeout");
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Key ${cfg.key}`, "content-type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(remaining),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: res.status, ok: res.ok, text, json };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return name === "TimeoutError" || name === "AbortError" ? fail("timeout") : fail("unavailable", undefined, String(err));
    }
  };
  const isFailure = (x: Http | FalResult): x is FalResult => "reason" in x;
  const detailOf = (h: Http) => {
    const d = (h.json as { detail?: unknown } | undefined)?.detail;
    return typeof d === "string" ? d : h.text;
  };

  // 1. submit
  const submit = await call(`${cfg.baseUrl.replace(/\/$/, "")}/${cfg.model}`, {
    method: "POST",
    body: JSON.stringify({
      prompt: opts.prompt,
      image_urls: [opts.referenceUrl],
      num_images: 1,
      aspect_ratio: "1:1",
      output_format: "jpeg",
    }),
  });
  if (isFailure(submit)) return submit;
  if (!submit.ok) return fail(mapFalError(submit.status, detailOf(submit)), submit.status, detailOf(submit));
  const queued = submit.json as { status_url?: unknown; response_url?: unknown } | undefined;
  if (typeof queued?.status_url !== "string" || typeof queued?.response_url !== "string") {
    return fail("bad_response", submit.status, "the queue answer had no status_url or response_url");
  }
  // The URLs come from the response: only follow ones on the same origin as the API we called.
  const origin = new URL(cfg.baseUrl).origin;
  try {
    if (new URL(queued.status_url).origin !== origin || new URL(queued.response_url).origin !== origin) {
      return fail("bad_response", undefined, "the queue answer pointed at another host");
    }
  } catch {
    return fail("bad_response", undefined, "the queue answer had an invalid URL");
  }

  // 2. poll until COMPLETED (a failed request also reports COMPLETED; the result call then carries the error)
  for (;;) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    const status = await call(queued.status_url, { method: "GET" });
    if (isFailure(status)) return status;
    if (!status.ok) return fail(mapFalError(status.status, detailOf(status)), status.status, detailOf(status));
    if ((status.json as { status?: string } | undefined)?.status === "COMPLETED") break;
  }

  // 3. the result
  const result = await call(queued.response_url, { method: "GET" });
  if (isFailure(result)) return result;
  if (!result.ok) return fail(mapFalError(result.status, detailOf(result)), result.status, detailOf(result));
  const first = (result.json as { images?: { url?: unknown; content_type?: unknown }[] } | undefined)?.images?.[0];
  if (typeof first?.url !== "string") return fail("bad_response", result.status, "no image in the result");
  return { ok: true, imageUrl: first.url, contentType: typeof first.content_type === "string" ? first.content_type : null };
}
