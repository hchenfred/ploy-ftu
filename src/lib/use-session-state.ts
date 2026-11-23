"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionState } from "@/lib/goals";

type Result = { id: string; state: SessionState | null; error: boolean; notFound: boolean };

async function fetchState(id: string): Promise<Result> {
  try {
    const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
    if (res.status === 404) return { id, state: null, error: false, notFound: true };
    if (!res.ok) return { id, state: null, error: true, notFound: false };
    return { id, state: (await res.json()) as SessionState, error: false, notFound: false };
  } catch {
    return { id, state: null, error: true, notFound: false };
  }
}

/**
 * Reads which step the user is on from the server (GET /api/sessions/[id]). The step lives in
 * sessions.status; the client only re-reads it, it never decides it.
 *
 * `loading` is true only until the first answer for this session id. `refresh()` re-reads in the
 * background and keeps showing the current step until the new state arrives.
 */
export function useSessionState(sessionId: string | null) {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchState(sessionId).then((r) => !cancelled && setResult(r));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const refresh = useCallback(() => {
    if (sessionId) fetchState(sessionId).then(setResult);
  }, [sessionId]);

  const current = sessionId && result?.id === sessionId ? result : null;
  return {
    state: current?.state ?? null,
    loading: sessionId !== null && current === null,
    error: current?.error ?? false,
    notFound: current?.notFound ?? false,
    refresh,
  };
}

/** Ask the server to move one step back (and clean up). Resolves false if it failed. */
export async function goBack(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/step/back", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
