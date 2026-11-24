import { notFound } from "next/navigation";
import { AdCard } from "@/components/artifact/ad-card";
import { PagePreview } from "@/components/artifact/page-preview";
import { PlaybookView } from "@/components/artifact/playbook-view";
import * as F from "@/lib/artifact/fixtures";

// Development-only page that shows every artifact component in every state (normal, partial, empty, hostile), so the
// previews can be tested without a backend. It is a 404 in a production build.
export default function ArtifactFixtures() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-10 px-4 py-8">
      <h1 className="font-heading text-2xl font-semibold">Artifact fixtures (development only)</h1>

      <section data-testid="page-normal"><PagePreview page={F.PAGE} profile={F.PROFILE} /></section>
      <section data-testid="page-partial"><PagePreview page={F.PAGE_PARTIAL} profile={F.PROFILE} /></section>
      <section data-testid="page-empty"><PagePreview page={F.PAGE_EMPTY} profile={F.PROFILE_NO_BRAND} /></section>
      <section data-testid="page-hostile"><PagePreview page={F.PAGE_HOSTILE} profile={F.PROFILE_HOSTILE} /></section>

      <section data-testid="playbook-normal"><PlaybookView playbook={F.PLAYBOOK} /></section>
      <section data-testid="playbook-partial"><PlaybookView playbook={F.PLAYBOOK_PARTIAL} /></section>
      <section data-testid="playbook-empty"><PlaybookView playbook={F.PLAYBOOK_EMPTY} /></section>
      <section data-testid="playbook-hostile"><PlaybookView playbook={F.PLAYBOOK_HOSTILE} /></section>

      <section data-testid="ad-card-normal">
        <AdCard headline="Fresh bread daily" accent="#01468b" name="Starter Bakery" logoUrl={null} imageUrl={null} />
      </section>
      <section data-testid="ad-card-no-headline">
        <AdCard headline="" accent="#01468b" name="Starter Bakery" />
      </section>
      <section data-testid="ad-card-bad-accent">
        <AdCard headline="Fresh bread daily" accent="red; background:url(https://evil.example/x)" name="Starter Bakery" />
      </section>
      <section data-testid="ad-card-hostile">
        <AdCard headline={F.HOSTILE} accent="#01468b" name={F.LONG_WORD} logoUrl={F.HOSTILE_LOGO} />
      </section>
      <section data-testid="ad-image">
        <AdCard headline="Fresh bread daily" accent="#01468b" name="Starter Bakery" imageUrl={F.TINY_PNG} />
      </section>
      <section data-testid="ad-image-broken">
        <AdCard headline="Fresh bread daily" accent="#01468b" name="Starter Bakery" imageUrl="/does-not-exist.png" />
      </section>
    </main>
  );
}
