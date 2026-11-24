"use client";

import { useState } from "react";
import type { SessionState } from "@/lib/goals";
import { goBack } from "@/lib/use-session-state";

// Where Milestone 2 stops: the goal is saved. Building the page comes next ("Coming soon").
export function NextUpStep({
  sessionId,
  state,
  onChange,
}: {
  sessionId: string;
  state: SessionState;
  onChange: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const goalText = state.goal?.label ?? "";

  // building -> goal: the server clears the saved goal and keeps the suggestions (no new model request).
  async function changeGoal() {
    setLeaving(true);
    setLeaveError(false);
    const ok = await goBack(sessionId);
    setLeaving(false);
    if (!ok) return setLeaveError(true);
    onChange();
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your goal is saved</h1>

      <div className="flex flex-col gap-1 rounded-2xl border border-foreground/10 bg-white p-5">
        <p className="text-sm text-foreground/70">Your goal</p>
        <p className="font-heading text-lg font-semibold">{goalText}</p>
      </div>

      <p className="text-base">Next: we&apos;ll build your first page. Coming soon.</p>

      {leaveError && (
        <p role="alert" className="text-sm">
          We couldn&apos;t go back. Please try again.
        </p>
      )}
      <button
        type="button"
        onClick={() => void changeGoal()}
        disabled={leaving}
        className="self-start rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        Change my goal
      </button>
    </section>
  );
}
