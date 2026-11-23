// Helpers for model-call errors. No secrets, so the client can import RATE_LIMIT_MESSAGE too.

// Shown in the UI when the model provider rate-limits us. The default model is a free-tier one
// capped at ~5 requests/min, so this is the most likely failure in development.
export const RATE_LIMIT_MESSAGE =
  "Rate limit reached: the free-tier AI model allows only about 5 requests per minute. Wait a minute, then retry.";

// Walk the cause chain: the SDK wraps the gateway's error in a retry error.
function chain(error: unknown): Array<{ statusCode?: number; name?: string; message?: string }> {
  const out = [];
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const err = e as { statusCode?: number; name?: string; message?: string; cause?: unknown; lastError?: unknown };
    out.push(err);
    e = err.lastError ?? err.cause;
  }
  return out;
}

export function isRateLimitError(error: unknown): boolean {
  return chain(error).some((e) => e.statusCode === 429 || /rate.?limit/i.test(e.message ?? ""));
}

// AbortSignal.timeout() rejects with a TimeoutError; a manual abort with an AbortError.
export function isTimeoutError(error: unknown): boolean {
  return chain(error).some((e) => e.name === "TimeoutError" || e.name === "AbortError" || /timed? ?out/i.test(e.message ?? ""));
}
