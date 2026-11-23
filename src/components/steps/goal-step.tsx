"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { goBack } from "@/lib/use-session-state";
import type { SessionState } from "@/lib/goals";

// PLACEHOLDER until the next build step: the real goal cards replace this. It exists so the shell
// can already route to step 2 without a dead end (back works).
export function GoalStep({
  sessionId,
  state,
  onChange,
}: {
  sessionId: string;
  state: SessionState;
  onChange: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your goal</h1>
      <p className="text-base">
        {state.profile?.name ?? state.profile?.description ?? "Your business"}: goal suggestions are coming next.
      </p>
      <Button
        type="button"
        variant="ghost"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          await goBack(sessionId);
          setLeaving(false);
          onChange();
        }}
        className="self-start underline underline-offset-4"
      >
        Use a different website
      </Button>
    </section>
  );
}
