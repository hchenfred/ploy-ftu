"use client";

import { useEffect, useRef, useState } from "react";
import { useObject } from "@ai-sdk/react";
import { Loader2 } from "lucide-react";
import { AdCard } from "@/components/artifact/ad-card";
import { PagePreview } from "@/components/artifact/page-preview";
import { PlaybookView } from "@/components/artifact/playbook-view";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RATE_LIMIT_MESSAGE } from "@/lib/ai-errors";
import type { AdCreative } from "@/lib/artifact/ad";
import { pageModelSchema, type PageDefinition, type PartialPage } from "@/lib/artifact/page";
import { playbookModelSchema, type PartialPlaybook, type Playbook } from "@/lib/artifact/playbook";
import { CLIENT_GIVE_UP_SECONDS } from "@/lib/artifact/limits";
import type { ArtifactProfile } from "@/lib/artifact/types";
import { GOAL_CATALOG, type SessionState } from "@/lib/goals";
import { downsizeToJpeg } from "@/lib/image-client";
import { goBack } from "@/lib/use-session-state";

type Artifact = NonNullable<SessionState["artifact"]>;
const MAX_GENERATIONS = 3;

// The progress steps are a light, time-based guide: they advance on a timer and hold on the last one. The model gives no real
// progress signal, so the screen says so instead of pretending.
const STEPS: Record<Artifact["type"], string[]> = {
  page: ["Reading your site", "Choosing the layout", "Writing the copy", "Checking the page"],
  playbook: ["Reading your site", "Planning the campaign", "Writing the tasks", "Checking the plan"],
  ad_creative: ["Reading your photo", "Setting up the scene", "Creating the image", "Checking the result"],
};
const STEP_SECONDS = 7;
const GIVE_UP_SECONDS = CLIENT_GIVE_UP_SECONDS;
const NOUN: Record<Artifact["type"], string> = { page: "landing page", playbook: "campaign playbook", ad_creative: "ad" };

type Failure = "busy" | "limit" | "saved" | "wrong_step" | "network";

async function failureOf(res: Response): Promise<Failure> {
  const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
  return error === "busy" || error === "limit" || error === "saved" || error === "wrong_step" ? error : "network";
}
function failureFromMessage(message: string): Failure {
  try {
    const error = (JSON.parse(message) as { error?: string }).error;
    return error === "busy" || error === "limit" || error === "saved" || error === "wrong_step" ? error : "network";
  } catch {
    return "network";
  }
}
const FAILURE_TEXT: Record<Failure, string> = {
  busy: "", // handled by waiting for the other generation
  limit: "You have used all three tries. You can still save this version.",
  saved: "This one is already saved.",
  wrong_step: "Something changed while we were working. Please refresh the page.",
  network: "We couldn't reach the server. Please try again.",
};

/** One short sentence about why this is a standard version instead of what the AI made, or null when nothing went wrong. */
function fallbackNote(a: Artifact): string | null {
  if (a.source === "fallback") {
    if (a.reason === "rate_limited") return RATE_LIMIT_MESSAGE;
    if (a.reason === "timeout") return "That took too long, so we used a standard version. You can try again.";
    return "We couldn't use the AI's answer this time, so here is a standard version. You can try again.";
  }
  if (a.source === "card" && a.reason) {
    if (a.reason === "not_configured") return "Image creation isn't set up yet, so here is a text-only card.";
    return "We couldn't make the image this time, so here is a text-only card. You can try again.";
  }
  return null;
}

function profileOf(state: SessionState): ArtifactProfile {
  const p = state.profile;
  return {
    name: p?.name ?? null,
    domain: p?.domain ?? null,
    summary: p?.summary ?? null,
    description: p?.description ?? null,
    brand: { name: p?.brand?.name ?? null, logoUrl: p?.brand?.logoUrl ?? null, colors: p?.brand?.colors ?? [] },
  };
}

function Working({ steps, index, partial }: { steps: string[]; index: number; partial: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-label="Progress" className="flex flex-col gap-2 rounded-2xl border border-foreground/10 bg-white p-5">
        <ol className="flex flex-col gap-2 text-sm">
          {steps.map((label, i) => (
            <li key={label} className={`flex items-center gap-2 ${i > index ? "text-foreground/40" : ""}`} aria-current={i === index ? "step" : undefined}>
              {i < index ? <span aria-hidden="true">✓</span> : i === index ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <span aria-hidden="true" className="size-4" />}
              <span className={i === index ? "font-medium" : ""}>{label}…</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-foreground/60">These steps are a guide, not exact progress. It can take a minute or more.</p>
      </div>
      {partial}
    </div>
  );
}

// Step 3: "First win". Make one artifact for the chosen goal, preview it, let the user save it, then hand them to the Ploy
// primitive where it lives. Everything is read back from the server's state, so a refresh resumes the same screen.
export function BuildStep({ sessionId, state, onChange }: { sessionId: string; state: SessionState; onChange: () => void }) {
  const { resetSession } = useSession();
  const goal = state.goal!;
  const type = GOAL_CATALOG[goal.goalType].artifactType;
  const artifact = state.artifact;
  const profile = profileOf(state);
  const name = profile.name ?? profile.domain ?? "your business";
  const noun = NOUN[type];

  const [headline, setHeadline] = useState("");
  const [generating, setGenerating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [startGenerations, setStartGenerations] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const ticks = useRef(0);

  // The streamed answer for a page or playbook: partial objects arrive here; the server validates, clips and saves the final one.
  const stream = useObject({
    api: "/api/artifact/generate",
    schema: type === "page" ? pageModelSchema : playbookModelSchema,
    onFinish: () => onChange(), // read the saved draft back
    onError: (e) => fail(failureFromMessage(e.message)),
  });

  // "Waiting" lasts until the server's state shows a newer generation than the one we started from.
  const waiting = generating && !(artifact && artifact.generations > startGenerations);
  const elapsed = waiting ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const timedOut = waiting && elapsed > GIVE_UP_SECONDS;

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      setNow(Date.now());
      ticks.current += 1;
      if (polling && ticks.current % 3 === 0) onChange(); // another generation is running: look for its result
    }, 1000);
    return () => clearInterval(id);
  }, [waiting, polling, onChange]);

  useEffect(() => () => void (thumb && URL.revokeObjectURL(thumb)), [thumb]);

  // Leaving this screen (Change my goal, Start over) closes the request instead of letting its result land on a screen that is gone.
  // The server still saves what it finished, so nothing is lost.
  const stopStream = stream.stop;
  useEffect(() => () => stopStream(), [stopStream]);

  function fail(kind: Failure) {
    if (kind === "busy") {
      setPolling(true); // someone (a reload, a second tab) is already generating: wait for it
      return;
    }
    setGenerating(false);
    setFailure(kind);
  }

  async function generate() {
    if (waiting) return;
    const t = Date.now();
    setFailure(null);
    setPolling(false);
    setStartedAt(t);
    setNow(t);
    ticks.current = 0;
    setStartGenerations(artifact?.generations ?? 0);
    setGenerating(true);
    if (type === "ad_creative") {
      try {
        const res = await fetch("/api/artifact/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, headline: headline.trim() || undefined }),
        });
        if (!res.ok) return fail(await failureOf(res));
        onChange(); // the saved ad is read back
      } catch {
        fail("network");
      }
    } else {
      stream.clear();
      stream.submit({ sessionId });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch("/api/artifact/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onChange();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function changeGoal() {
    setLeaving(true);
    setLeaveError(false);
    const ok = await goBack(sessionId); // the server deletes the draft, the images and the photo
    setLeaving(false);
    if (!ok) return setLeaveError(true);
    onChange();
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const blob = await downsizeToJpeg(file); // shrunk in the browser; also drops location data
      const form = new FormData();
      form.set("sessionId", sessionId);
      form.set("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/uploads/photo", { method: "POST", body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "failed");
      setThumb(URL.createObjectURL(blob));
      onChange();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setPhotoError(
        code === "unsupported_type"
          ? "Please choose a JPEG, PNG or WebP photo."
          : code === "too_large"
            ? "That photo is too large. Please choose a smaller one."
            : "We couldn't upload the photo. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  const goalLine = <p className="text-sm text-foreground/70">Your goal: {goal.label}</p>;

  const leaveControls = (
    <>
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
    </>
  );

  // ---- the artifact itself, as a preview ----
  const view = (a: Artifact) =>
    a.type === "page" ? (
      <PagePreview page={a.content as PageDefinition} profile={profile} />
    ) : a.type === "playbook" ? (
      <PlaybookView playbook={a.content as Playbook} />
    ) : (
      <AdCard
        headline={(a.content as AdCreative).headline}
        accent={(a.content as AdCreative).accent}
        name={name}
        logoUrl={profile.brand.logoUrl}
        imageUrl={a.imageUrl}
      />
    );

  // ---- saved: the artifact and the hand-off to Ploy ----
  if (artifact?.saved) {
    const handoff = GOAL_CATALOG[goal.goalType].handoff;
    return (
      <section className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your {noun} is saved</h1>
        {view(artifact)}
        <section aria-label="Next in Ploy" className="flex flex-col gap-2 rounded-2xl border border-foreground/10 bg-white p-5">
          <h2 className="font-heading text-lg font-semibold">{handoff.title}</h2>
          <p className="text-sm text-foreground/80">{handoff.text}</p>
          <a
            href={handoff.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // Log the click first; keepalive lets the request finish after the new tab opens, and a failure never blocks the link.
              void fetch("/api/handoff", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId }),
                keepalive: true,
              }).catch(() => {});
            }}
            className="mt-2 inline-flex h-11 items-center self-start rounded-full bg-foreground px-6 text-base font-medium text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continue in Ploy
          </a>
        </section>
        <button
          type="button"
          onClick={resetSession}
          className="self-start rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Start over
        </button>
      </section>
    );
  }

  // ---- generating ----
  if (waiting) {
    const steps = STEPS[type];
    const index = Math.min(steps.length - 1, Math.floor(elapsed / STEP_SECONDS));
    const partial = stream.object && type !== "ad_creative" ? (
      type === "page" ? <PagePreview page={stream.object as PartialPage} profile={profile} /> : <PlaybookView playbook={stream.object as PartialPlaybook} />
    ) : null;
    return (
      <section className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Making your {noun}</h1>
        {goalLine}
        <Working steps={steps} index={index} partial={partial} />
        {timedOut && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p>This is taking longer than usual.</p>
            <Button type="button" onClick={() => void generate()} className="h-10 rounded-full px-5">
              Try again
            </Button>
          </div>
        )}
      </section>
    );
  }

  // ---- preview: the draft, with Regenerate and Save ----
  if (artifact) {
    const left = Math.max(0, MAX_GENERATIONS - artifact.generations);
    const note = fallbackNote(artifact);
    return (
      <section className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your {noun}</h1>
        {goalLine}
        {note && (
          <p role="status" className="rounded-2xl border border-foreground/15 bg-white p-4 text-sm">
            {note}
          </p>
        )}
        {view(artifact)}
        {failure && failure !== "busy" && (
          <p role="alert" className="text-sm">
            {FAILURE_TEXT[failure]}
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-sm">
            We couldn&apos;t save it. Please try again.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={saving} className="h-11 rounded-full px-6 text-base">
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void generate()}
            disabled={left === 0}
            className="h-11 rounded-full px-6 text-base"
          >
            Regenerate ({left} left)
          </Button>
        </div>
        {leaveControls}
      </section>
    );
  }

  // ---- intro: nothing made yet ----
  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Let&apos;s make your first {noun}</h1>
      {goalLine}
      <p className="text-base text-foreground/80">
        {type === "ad_creative"
          ? `Add a photo of your product and we'll turn it into an ad for ${name}.`
          : `We'll write it from what we learned about ${name}. It can take a minute or more.`}
      </p>

      {type === "ad_creative" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-photo">Product photo</Label>
            <input
              id="product-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => void onPhoto(e.target.files?.[0])}
              className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-foreground file:px-4 file:py-2 file:text-sm file:text-background"
            />
            {uploading && (
              <p role="status" className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Uploading your photo…
              </p>
            )}
            {state.photo && !uploading && (
              <p role="status" className="flex items-center gap-3 text-sm">
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="Your product photo" className="size-16 rounded-lg border border-foreground/10 object-cover" />
                )}
                <span>Photo uploaded ({Math.max(1, Math.round(state.photo.bytes / 1024))} KB)</span>
              </p>
            )}
            {photoError && (
              <p role="alert" className="text-sm">
                {photoError}
              </p>
            )}
            <p className="text-xs text-foreground/60">Your photo is sent to an image service (fal) to make the ad.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ad-headline">Headline (optional)</Label>
            <Input
              id="ad-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={60}
              placeholder={name}
              className="h-11 rounded-full bg-white px-4 text-base"
            />
            <p className="text-xs text-foreground/60">Leave it empty and we&apos;ll use your business name. We never add an offer you didn&apos;t write.</p>
          </div>
        </div>
      )}

      {failure && failure !== "busy" && (
        <p role="alert" className="text-sm">
          {FAILURE_TEXT[failure]}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void generate()}
          disabled={uploading || (type === "ad_creative" && !state.photo)}
          className="h-11 rounded-full px-6 text-base"
        >
          Generate
        </Button>
        {type === "ad_creative" && !state.photo && (
          <Button type="button" variant="outline" onClick={() => void generate()} disabled={uploading} className="h-11 rounded-full px-6 text-base">
            Skip the photo
          </Button>
        )}
      </div>
      {leaveControls}
    </section>
  );
}
