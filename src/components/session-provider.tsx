"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const SESSION_KEY = "ftu_session_id";

// One in-flight session request per page load. React Strict Mode runs effects
// twice in dev; sharing the promise keeps that from creating two sessions rows.
let sessionPromise: Promise<string> | null = null;

function ensureSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) return saved;
      } catch {
        // storage blocked: fall through and create a session for this page load only
      }
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error("Could not start a session");
      const { sessionId } = (await res.json()) as { sessionId: string };
      try {
        localStorage.setItem(SESSION_KEY, sessionId);
      } catch {
        // ignore: the session still works for this page load
      }
      return sessionId;
    })();
    sessionPromise.catch(() => {
      sessionPromise = null; // allow a retry
    });
  }
  return sessionPromise;
}

type SessionContextValue = {
  /** null until the session is ready (or if it failed to start). */
  sessionId: string | null;
  error: boolean;
  retry: () => void;
  /** Forget the stored id and start a fresh session (used when the server no longer knows the stored one). */
  resetSession: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

// Owns the onboarding session id for the whole app. Any client component can read it with useSession().
// The id is a random UUID, not a secret; the server still passes it to tools itself, never via the model.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then((id) => !cancelled && setSessionId(id))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = useCallback(() => {
    setError(false);
    ensureSession()
      .then(setSessionId)
      .catch(() => setError(true));
  }, []);

  const resetSession = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // storage blocked: a new session is created below anyway
    }
    sessionPromise = null;
    ensureSession()
      .then(setSessionId)
      .catch(() => setError(true));
  }, []);

  const value = useMemo(
    () => ({ sessionId, error, retry, resetSession }),
    [sessionId, error, retry, resetSession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
