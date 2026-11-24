import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { generateAdImage, mapFalError, type FalConfig } from "../../src/lib/artifact/fal-client.ts";

// The fal client against a stub server standing in for queue.fal.run. The real API is never called in tests.

type Seen = { method: string; url: string; auth: string | undefined; body: unknown };
let server: Server;
let base = "";
let seen: Seen[] = [];
let handler: (req: IncomingMessage, url: string, body: unknown) => { status: number; body: unknown } | "hang" = () => ({ status: 404, body: {} });

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      let body: unknown = undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const out = handler(req, req.url ?? "", body);
      if (out === "hang") return; // never answer
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const cfg = (over: Partial<FalConfig> = {}): FalConfig => ({ baseUrl: base, key: "test-key-123", model: "google/nano-banana-2.1/edit", ...over });
const run = (over: Partial<FalConfig> = {}, deadlineMs = 5_000) =>
  generateAdImage(cfg(over), { prompt: "make an ad", referenceUrl: "https://example.test/ref.jpg", deadlineMs, pollMs: 10 });
const reset = (h: typeof handler) => {
  seen = [];
  handler = h;
};

/** A stub that behaves like the queue: submit -> status (IN_QUEUE once, then COMPLETED) -> result. */
const happy = (result: { status: number; body: unknown } = { status: 200, body: { images: [{ url: "https://v3.fal.media/files/out.jpg", content_type: "image/jpeg", width: 1024, height: 1024 }], description: "" } }) => {
  let polls = 0;
  return (_req: IncomingMessage, url: string) => {
    if (url === "/google/nano-banana-2.1/edit") return { status: 200, body: { request_id: "r1", status_url: `${base}/status/r1`, response_url: `${base}/result/r1` } };
    if (url === "/status/r1") return { status: 200, body: { status: ++polls < 2 ? "IN_QUEUE" : "COMPLETED" } };
    if (url === "/result/r1") return result;
    return { status: 404, body: {} };
  };
};

test("success: submit, poll until COMPLETED, read the image; the request has the right shape and auth", async () => {
  reset(happy());
  const r = await run();
  assert.deepEqual(r, { ok: true, imageUrl: "https://v3.fal.media/files/out.jpg", contentType: "image/jpeg" });
  const submit = seen[0];
  assert.equal(submit.method, "POST");
  assert.equal(submit.url, "/google/nano-banana-2.1/edit");
  assert.equal(submit.auth, "Key test-key-123");
  assert.deepEqual(submit.body, {
    prompt: "make an ad",
    image_urls: ["https://example.test/ref.jpg"],
    num_images: 1,
    aspect_ratio: "1:1",
    output_format: "jpeg",
  });
  assert.ok(seen.filter((s) => s.url === "/status/r1").length >= 2); // it polled at least twice
  assert.ok(seen.every((s) => s.auth === "Key test-key-123")); // every call carried the key
});

test("the real 403 'Exhausted balance' answer from fal is a billing failure, with the message kept", async () => {
  reset(() => ({ status: 403, body: { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." } }));
  const r = await run();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "billing");
    assert.equal(r.status, 403);
    assert.match(r.detail ?? "", /Exhausted balance/);
  }
  assert.equal(seen.length, 1); // it did not keep polling
});

test("HTTP errors map to reasons: 401, other 403, 402, 429, 422, 5xx, anything else", async () => {
  for (const [status, detail, reason] of [
    [401, "Invalid key", "unauthorized"],
    [403, "Forbidden", "unauthorized"],
    [402, "Payment required", "billing"],
    [429, "Too many requests", "rate_limited"],
    [422, "Rejected by the safety checker", "blocked"],
    [422, "Field required", "unknown"],
    [503, "runner error", "unavailable"],
    [504, "timeout", "unavailable"],
    [418, "teapot", "unknown"],
  ] as const) {
    reset(() => ({ status, body: { detail } }));
    const r = await run();
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, reason, `${status} ${detail}`);
    assert.equal(mapFalError(status, detail), reason);
  }
});

test("a submit answer without status and response URLs is a bad response", async () => {
  for (const body of [{}, { request_id: "x" }, "not json at all", { status_url: 1, response_url: 2 }]) {
    reset(() => ({ status: 200, body }));
    const r = await run();
    assert.ok(!r.ok && r.reason === "bad_response", JSON.stringify(body));
  }
});

test("status and response URLs on another host are never followed", async () => {
  reset(() => ({ status: 200, body: { request_id: "r", status_url: "https://evil.example/status", response_url: `${base}/result/r` } }));
  const r = await run();
  assert.ok(!r.ok && r.reason === "bad_response");
  assert.equal(seen.length, 1); // only the submit call was made
  reset(() => ({ status: 200, body: { request_id: "r", status_url: "not a url", response_url: "also not" } }));
  const r2 = await run();
  assert.ok(!r2.ok && r2.reason === "bad_response");
});

test("a result without an image, or an error on the result call after COMPLETED, is reported", async () => {
  reset(happy({ status: 200, body: { images: [] } }));
  const none = await run();
  assert.ok(!none.ok && none.reason === "bad_response");
  reset(happy({ status: 422, body: { detail: "The image was blocked by the content policy" } }));
  const blocked = await run();
  assert.ok(!blocked.ok && blocked.reason === "blocked"); // a failed request reports COMPLETED; the result call carries the error
  reset(happy({ status: 200, body: { images: [{ url: 42 }] } }));
  const bad = await run();
  assert.ok(!bad.ok && bad.reason === "bad_response");
});

test("a request that never completes gives up at the deadline", async () => {
  reset((_req, url) =>
    url === "/google/nano-banana-2.1/edit"
      ? { status: 200, body: { request_id: "r", status_url: `${base}/status/r`, response_url: `${base}/result/r` } }
      : { status: 200, body: { status: "IN_PROGRESS" } },
  );
  const t = Date.now();
  const r = await run({}, 400);
  assert.ok(!r.ok && r.reason === "timeout");
  assert.ok(Date.now() - t < 2_000);
  reset(() => "hang"); // the server never answers at all
  const hung = await run({}, 300);
  assert.ok(!hung.ok && hung.reason === "timeout");
});

test("an unreachable server is 'unavailable'", async () => {
  const r = await run({ baseUrl: "http://127.0.0.1:1" });
  assert.ok(!r.ok && r.reason === "unavailable");
});

test("the API key never appears in an error detail", async () => {
  reset(() => ({ status: 401, body: { detail: "Key test-key-123 is not valid for test-key-123" } }));
  const r = await run();
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.ok(!(r.detail ?? "").includes("test-key-123"), r.detail);
    assert.match(r.detail ?? "", /\[key\]/);
    assert.ok((r.detail ?? "").length <= 200);
  }
});
