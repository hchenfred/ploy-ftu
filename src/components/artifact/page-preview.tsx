import { deriveTheme } from "@/lib/artifact/theme";
import type { PartialPage } from "@/lib/artifact/page";
import { displayName, type ArtifactProfile } from "@/lib/artifact/types";
import { BrandMark } from "./brand-mark";

// A preview of the landing page (not published). It renders only our fields, as text: no raw HTML, no links from model
// text, and the buttons are inert styled spans. Every field may be missing, so the same component renders a stream that is
// still arriving. Long words wrap instead of widening the page.
const WRAP = "[overflow-wrap:anywhere]";

export function PagePreview({ page, profile }: { page: PartialPage; profile: ArtifactProfile }) {
  const { accent, onAccent } = deriveTheme(profile.brand.colors);
  const name = displayName(profile);
  const benefits = (page.benefits ?? []).filter((b) => b && (b.title || b.text));
  const empty = !page.hero?.headline && !page.hero?.subhead && benefits.length === 0 && !page.about && !page.quote;
  const button = (label: string) => (
    <span
      className="inline-flex h-10 items-center rounded-full px-5 text-sm font-medium"
      style={{ backgroundColor: accent, color: onAccent }}
    >
      {label}
    </span>
  );

  return (
    <article aria-label="Landing page preview" className={`overflow-hidden rounded-2xl border border-foreground/10 bg-white ${WRAP}`}>
      <header className="flex items-center gap-3 border-b border-foreground/10 p-4">
        <BrandMark name={name} logoUrl={profile.brand.logoUrl} />
        <span className="font-heading text-base font-semibold">{name}</span>
      </header>

      {empty ? (
        <div aria-hidden="true" data-testid="skeleton" className="flex flex-col gap-3 p-6">
          <div className="h-6 w-3/4 rounded bg-foreground/10" />
          <div className="h-4 w-1/2 rounded bg-foreground/10" />
          <div className="h-10 w-32 rounded-full bg-foreground/10" />
        </div>
      ) : (
        <div className="flex flex-col gap-8 p-6">
          {(page.hero?.headline || page.hero?.subhead || page.hero?.cta) && (
            <section aria-label="Hero" className="flex flex-col gap-3">
              {page.hero?.headline && <h3 className="font-heading text-2xl font-semibold tracking-tight">{page.hero.headline}</h3>}
              {page.hero?.subhead && <p className="text-base text-foreground/80">{page.hero.subhead}</p>}
              {page.hero?.cta && <div>{button(page.hero.cta)}</div>}
            </section>
          )}

          {benefits.length > 0 && (
            <ul aria-label="Benefits" className="grid gap-4 sm:grid-cols-3">
              {benefits.map((b, i) => (
                <li key={i} className="flex flex-col gap-1 rounded-xl border border-foreground/10 p-4">
                  {b?.title && <h4 className="font-heading text-sm font-semibold">{b.title}</h4>}
                  {b?.text && <p className="text-sm text-foreground/70">{b.text}</p>}
                </li>
              ))}
            </ul>
          )}

          {(page.about?.title || page.about?.text) && (
            <section aria-label="About" className="flex flex-col gap-1">
              {page.about?.title && <h4 className="font-heading text-lg font-semibold">{page.about.title}</h4>}
              {page.about?.text && <p className="text-base text-foreground/80">{page.about.text}</p>}
            </section>
          )}

          {(page.quote?.title || page.quote?.text || page.quote?.button) && (
            <section aria-label="Quote request" className="flex flex-col gap-3 rounded-xl bg-foreground/5 p-4">
              {page.quote?.title && <h4 className="font-heading text-lg font-semibold">{page.quote.title}</h4>}
              {page.quote?.text && <p className="text-sm text-foreground/80">{page.quote.text}</p>}
              <div aria-hidden="true" className="flex flex-col gap-2">
                <div className="h-9 rounded-lg border border-foreground/15 bg-white" />
                <div className="h-9 rounded-lg border border-foreground/15 bg-white" />
                <div className="h-16 rounded-lg border border-foreground/15 bg-white" />
              </div>
              {page.quote?.button && <div>{button(page.quote.button)}</div>}
            </section>
          )}
        </div>
      )}
      <p className="border-t border-foreground/10 px-6 py-3 text-xs text-foreground/60">Preview only. Nothing is sent.</p>
    </article>
  );
}
