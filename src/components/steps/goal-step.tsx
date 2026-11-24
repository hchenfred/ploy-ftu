"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RATE_LIMIT_MESSAGE } from "@/lib/ai-errors";
import {
  ALL_DEFAULT_GOALS,
  type GoalType,
  type SessionState,
  type SuggestedGoal,
  type SuggestGoalsResponse,
} from "@/lib/goals";
import { goBack } from "@/lib/use-session-state";

type Choice = GoalType | "custom";

// One in-flight suggestions request per session. React Strict Mode runs effects twice in dev; sharing the
// promise keeps that from spending two model requests (the free model allows ~5 per minute).
const inflight = new Map<string, Promise<SuggestGoalsResponse>>();

function requestSuggestions(sessionId: string): Promise<SuggestGoalsResponse> {
  let promise = inflight.get(sessionId);
  if (!promise) {
    promise = fetch("/api/goals/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(30_000),
    })
      .then(async (res): Promise<SuggestGoalsResponse> =>
        res.ok ? ((await res.json()) as SuggestGoalsResponse) : { ok: false, reason: "unknown" },
      )
      .catch((err): SuggestGoalsResponse => ({
        ok: false,
        reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unknown",
      }))
      .finally(() => inflight.delete(sessionId));
    inflight.set(sessionId, promise);
  }
  return promise;
}

const CUSTOM_OPTION = { key: "custom" as const, label: "Something else", reason: "Describe your own goal." };

// Step 2: "Your goal". Shows the saved suggestions right away, or asks the server for them (one model
// request). If that fails, the four common goals are shown instead, so there is never a dead end.
export function GoalStep({
  sessionId,
  state,
  onChange,
}: {
  sessionId: string;
  state: SessionState;
  onChange: () => void;
}) {
  const savedGoals = state.profile?.suggestedGoals ?? null;
  const [result, setResult] = useState<SuggestGoalsResponse | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (savedGoals) return; // saved suggestions are reused: a refresh never spends a model request
    let cancelled = false;
    requestSuggestions(sessionId).then((r) => !cancelled && setResult(r));
    return () => {
      cancelled = true;
    };
  }, [sessionId, savedGoals]);

  const loading = !savedGoals && result === null;
  const failed = !savedGoals && result !== null && !result.ok;
  const goals: SuggestedGoal[] | null =
    savedGoals ?? (result?.ok ? result.goals : failed ? ALL_DEFAULT_GOALS : null);
  const summary = state.profile?.summary ?? (result?.ok ? result.summary : null);
  const name = state.profile?.name ?? state.profile?.domain ?? null;

  const options = goals ? [...goals.map((g) => ({ key: g.goalType as Choice, label: g.label, reason: g.reason })), CUSTOM_OPTION] : [];
  const canContinue = choice !== null && (choice !== "custom" || customText.trim().length >= 3);

  function retry() {
    setResult(null);
    setChoice(null);
    requestSuggestions(sessionId).then(setResult);
  }

  async function submit() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const body =
        choice === "custom"
          ? { sessionId, kind: "custom", customText: customText.trim() }
          : { sessionId, kind: "suggested", goalType: choice };
      const res = await fetch("/api/goals/choose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      onChange(); // the shell re-reads the status and moves to the next step
    } catch {
      setSubmitError(true); // the selection is kept so the user can retry
      setSubmitting(false);
    }
  }

  function onOptionKeyDown(e: KeyboardEvent, index: number) {
    if (e.key === "Enter" && canContinue) {
      e.preventDefault();
      void submit();
      return;
    }
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % options.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    setChoice(options[next].key);
    optionRefs.current[next]?.focus();
  }

  async function startOver() {
    setLeaving(true);
    setLeaveError(false);
    const ok = await goBack(sessionId);
    setLeaving(false);
    if (!ok) return setLeaveError(true);
    onChange();
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
        What do you want your website to do?
      </h1>

      {(name || summary) && (
        <p className="text-base text-foreground/80">
          {name && <span className="font-medium text-foreground">{name}</span>}
          {name && summary ? ": " : ""}
          {summary}
        </p>
      )}

      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-foreground/80">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Finding the best goals for {name ?? "your business"}…
        </p>
      )}

      {failed && (
        <div role="status" className="flex flex-col items-start gap-2 text-sm">
          <p>We couldn&apos;t tailor suggestions, so here are the common goals.</p>
          {result && !result.ok && result.reason === "rate_limited" && <p>{RATE_LIMIT_MESSAGE}</p>}
          <button
            type="button"
            onClick={retry}
            className="rounded underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Try again
          </button>
        </div>
      )}

      {goals && (
        <>
          <div role="radiogroup" aria-label="Your goal" className="flex flex-col gap-3">
            {options.map((opt, i) => {
              const selected = choice === opt.key;
              return (
                <button
                  key={opt.key}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (choice === null && i === 0) ? 0 : -1}
                  onClick={() => setChoice(opt.key)}
                  onKeyDown={(e) => onOptionKeyDown(e, i)}
                  className={`flex flex-col items-start gap-1 rounded-2xl border bg-white p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    selected ? "border-foreground ring-2 ring-foreground" : "border-foreground/15 hover:border-foreground/40"
                  }`}
                >
                  <span className="font-heading text-base font-semibold">{opt.label}</span>
                  <span className="text-sm text-foreground/70">{opt.reason}</span>
                </button>
              );
            })}
          </div>

          {choice === "custom" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="custom-goal">Describe your goal</Label>
              <Input
                id="custom-goal"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                maxLength={300}
                placeholder="For example: sell more wedding cakes"
                className="h-11 rounded-full bg-white px-4 text-base"
              />
            </div>
          )}

          {submitError && (
            <p role="alert" className="text-sm">
              We couldn&apos;t save your goal. Please try again.
            </p>
          )}

          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canContinue || submitting}
            className="h-11 self-start rounded-full px-6 text-base"
          >
            Continue
          </Button>
        </>
      )}

      {leaveError && (
        <p role="alert" className="text-sm">
          We couldn&apos;t go back. Please try again.
        </p>
      )}
      <button
        type="button"
        onClick={() => void startOver()}
        disabled={leaving}
        className="self-start rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        Use a different website
      </button>
    </section>
  );
}
