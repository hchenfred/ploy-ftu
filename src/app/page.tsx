"use client";

import { useEffect, useRef } from "react";
import { ProgressSteps } from "@/components/progress-steps";
import { useSession } from "@/components/session-provider";
import { GoalStep } from "@/components/steps/goal-step";
import { NextUpStep } from "@/components/steps/next-up-step";
import { SiteStep } from "@/components/steps/site-step";
import { Button } from "@/components/ui/button";
import { useSessionState } from "@/lib/use-session-state";
import type { SessionStatus } from "@/lib/goals";

// The step comes from sessions.status on the server. site -> 0, goal -> 1, building/live -> 2.
const STEP_INDEX: Record<SessionStatus, number> = { site: 0, goal: 1, building: 2, live: 2 };

// Thin shell: reads the step from the server and renders the matching step component.
export default function Home() {
  const { sessionId, error: sessionError, retry: retrySession, resetSession } = useSession();
  const { state, loading, error, notFound, refresh } = useSessionState(sessionId);

  // A stored session id the server no longer knows (e.g. the database was reset): start a fresh one, once.
  const staleResets = useRef(0);
  useEffect(() => {
    if (notFound && staleResets.current < 1) {
      staleResets.current += 1;
      resetSession();
    }
  }, [notFound, resetSession]);

  const current = state ? STEP_INDEX[state.status] : 0;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-10 px-4 py-8 sm:py-12">
      <ProgressSteps current={current} />

      {sessionError && (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm">
          <p>We couldn&apos;t start your session.</p>
          <Button type="button" onClick={retrySession} className="h-10 rounded-full px-5">
            Try again
          </Button>
        </div>
      )}

      {!sessionError && !state && !error && (loading || !sessionId || notFound) && (
        <p role="status" className="text-sm text-foreground/80">
          Loading…
        </p>
      )}

      {!sessionError && error && (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm">
          <p>We couldn&apos;t load your progress.</p>
          <Button type="button" onClick={refresh} className="h-10 rounded-full px-5">
            Try again
          </Button>
        </div>
      )}

      {sessionId && state && (
        <>
          {state.status === "site" && <SiteStep sessionId={sessionId} onDone={refresh} />}
          {state.status === "goal" && <GoalStep sessionId={sessionId} state={state} onChange={refresh} />}
          {(state.status === "building" || state.status === "live") && <NextUpStep state={state} />}
        </>
      )}
    </main>
  );
}
