const STEPS = ["Your site", "Your goal", "First win"] as const;

// Three-step progress bar for the onboarding. `current` is the 0-based active step.
export function ProgressSteps({ current = 0 }: { current?: number }) {
  return (
    <nav aria-label="Onboarding progress">
      <ol className="flex w-full items-center gap-2">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li
              key={label}
              className="flex flex-1 flex-col gap-2"
              aria-current={state === "active" ? "step" : undefined}
            >
              <span
                className={`h-1 rounded-full ${state === "todo" ? "bg-foreground/15" : "bg-foreground"}`}
                aria-hidden="true"
              />
              <span
                className={`text-xs ${state === "todo" ? "text-foreground/60" : "font-medium text-foreground"}`}
              >
                <span className="sr-only">
                  Step {i + 1} of {STEPS.length}:{" "}
                </span>
                {label}
                {state === "done" && <span className="sr-only"> (completed)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
