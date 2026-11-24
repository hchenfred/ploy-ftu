import type { PartialPlaybook } from "@/lib/artifact/playbook";

// The campaign playbook: objective, audience, ordered tasks and one success metric. Renders only our fields, as text.
// Every field may be missing, so the same component renders a stream that is still arriving.
const WRAP = "[overflow-wrap:anywhere]";

export function PlaybookView({ playbook }: { playbook: PartialPlaybook }) {
  const tasks = (playbook.tasks ?? []).filter((t) => t && (t.title || t.detail));
  const m = playbook.successMetric;
  const empty = !playbook.title && !playbook.objective && !playbook.audience && tasks.length === 0 && !m;

  return (
    <article aria-label="Campaign playbook" className={`flex flex-col gap-6 rounded-2xl border border-foreground/10 bg-white p-6 ${WRAP}`}>
      {empty ? (
        <div aria-hidden="true" data-testid="skeleton" className="flex flex-col gap-3">
          <div className="h-6 w-2/3 rounded bg-foreground/10" />
          <div className="h-4 w-1/2 rounded bg-foreground/10" />
          <div className="h-4 w-3/4 rounded bg-foreground/10" />
        </div>
      ) : (
        <>
          {(playbook.title || playbook.objective || playbook.audience) && (
            <header className="flex flex-col gap-2">
              {playbook.title && <h3 className="font-heading text-2xl font-semibold tracking-tight">{playbook.title}</h3>}
              {playbook.objective && <p className="text-base text-foreground/80">{playbook.objective}</p>}
              {playbook.audience && (
                <p className="text-sm text-foreground/70">
                  <span className="font-medium text-foreground">For:</span> {playbook.audience}
                </p>
              )}
            </header>
          )}

          {tasks.length > 0 && (
            <ol aria-label="Tasks" className="flex flex-col gap-3">
              {tasks.map((t, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-foreground/10 p-4">
                  <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs text-background">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {t?.title && <h4 className="font-heading text-sm font-semibold">{t.title}</h4>}
                      {t?.when && <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{t.when}</span>}
                    </div>
                    {t?.detail && <p className="text-sm text-foreground/70">{t.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {m && (m.name || m.target || m.howToMeasure) && (
            <section aria-label="Success metric" className="flex flex-col gap-1 rounded-xl bg-foreground/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">Success metric</p>
              {m.name && <p className="font-heading text-base font-semibold">{m.name}</p>}
              {m.target && <p className="text-sm text-foreground/80">{m.target}</p>}
              {m.howToMeasure && <p className="text-sm text-foreground/70">{m.howToMeasure}</p>}
            </section>
          )}
        </>
      )}
    </article>
  );
}
