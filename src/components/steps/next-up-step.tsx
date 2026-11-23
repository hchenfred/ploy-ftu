import type { SessionState } from "@/lib/goals";

// PLACEHOLDER until the build step after the goal cards: the saved goal and "Change my goal" go here.
export function NextUpStep({ state }: { state: SessionState }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your goal is saved</h1>
      <p className="text-base">{state.goal?.label ?? "Next: we'll build your first page. Coming soon."}</p>
    </section>
  );
}
