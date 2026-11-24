import { z } from "zod";
import { clip } from "../goals.ts";
import {
  asArray,
  asObject,
  asString,
  displayName,
  type ArtifactProfile,
  type DeepPartial,
  type Validated,
} from "./types.ts";

// A landing page for a service business: hero, three benefits, about, and a quote section. No phone, address, hours or
// prices in the MVP: those are facts the model must not invent and the scraper often cannot find.
export type PageDefinition = {
  hero: { headline: string; subhead: string; cta: string };
  benefits: { title: string; text: string }[]; // exactly 3
  about: { title: string; text: string };
  quote: { title: string; text: string; button: string };
};
export type PartialPage = DeepPartial<PageDefinition>;

export const PAGE_LIMITS = { headline: 80, subhead: 160, cta: 30, benefitTitle: 50, benefitText: 140, aboutTitle: 50, aboutText: 300, quoteTitle: 60, quoteText: 160, button: 30 } as const;
export const PAGE_BENEFITS = 3;

/** The loose schema the model fills in (and `useObject` streams): short, complete text, no max(). */
export const pageModelSchema = z.object({
  hero: z.object({
    headline: z.string().describe("A clear headline that says what the business does for whom"),
    subhead: z.string().describe("One short supporting sentence"),
    cta: z.string().describe("A short button label that asks for a quote"),
  }),
  benefits: z
    .array(
      z.object({
        title: z.string().describe("A short benefit title"),
        text: z.string().describe("One short, complete sentence"),
      }),
    )
    .describe("Exactly 3 benefits that follow from the business description"),
  about: z.object({
    title: z.string().describe("A short section title"),
    text: z.string().describe("Two or three short sentences about the business, only using facts you were given"),
  }),
  quote: z.object({
    title: z.string().describe("A short title for the quote request section"),
    text: z.string().describe("One short sentence inviting people to describe what they need"),
    button: z.string().describe("A short submit button label"),
  }),
});

/** A deterministic, generic page: used when the model fails, and to fill any part the model left out. */
export function fallbackPage(profile: ArtifactProfile): PageDefinition {
  const name = displayName(profile);
  const about = profile.description || profile.summary || `${name} helps customers with what they need.`;
  const L = PAGE_LIMITS;
  return {
    hero: {
      headline: clip(`Work with ${name}`, L.headline),
      subhead: clip(profile.summary || "Tell us what you need and we will take it from there.", L.subhead),
      cta: "Request a quote",
    },
    benefits: [
      { title: "Simple to start", text: "Send a short request and we will take it from there." },
      { title: "Made for you", text: "Every job starts with a conversation about what you need." },
      { title: "Clear next steps", text: "You will know what happens after you get in touch." },
    ],
    about: { title: clip(`About ${name}`, L.aboutTitle), text: clip(about, L.aboutText) },
    quote: {
      title: "Request a quote",
      text: "Tell us a little about what you need and we will follow up.",
      button: "Send request",
    },
  };
}

/**
 * Turn whatever the model produced into a valid page: trim and clip every field, keep exactly 3 benefits, and fill any
 * missing part from the deterministic fallback. Returns null only when the model gave nothing usable (no headline and
 * no benefit), so the caller saves the full fallback instead. `filled` counts the parts that came from the fallback.
 */
export function validatePage(input: unknown, profile: ArtifactProfile): Validated<PageDefinition> | null {
  const o = asObject(input);
  if (!o) return null;
  const fb = fallbackPage(profile);
  const L = PAGE_LIMITS;
  let filled = 0;
  const pick = (v: unknown, max: number, fallback: string) => {
    const t = clip(asString(v), max);
    if (t) return t;
    filled++;
    return fallback;
  };

  const hero = asObject(o.hero);
  const modelHeadline = clip(asString(hero?.headline), L.headline);
  const benefits = asArray(o.benefits)
    .map((raw) => {
      const b = asObject(raw);
      return { title: clip(asString(b?.title), L.benefitTitle), text: clip(asString(b?.text), L.benefitText) };
    })
    .filter((b) => b.title && b.text)
    .slice(0, PAGE_BENEFITS);
  if (!modelHeadline && benefits.length === 0) return null; // nothing usable

  for (const f of fb.benefits) {
    if (benefits.length >= PAGE_BENEFITS) break;
    benefits.push(f);
    filled++;
  }
  const about = asObject(o.about);
  const quote = asObject(o.quote);
  return {
    value: {
      hero: {
        headline: modelHeadline || (filled++, fb.hero.headline),
        subhead: pick(hero?.subhead, L.subhead, fb.hero.subhead),
        cta: pick(hero?.cta, L.cta, fb.hero.cta),
      },
      benefits,
      about: {
        title: pick(about?.title, L.aboutTitle, fb.about.title),
        text: pick(about?.text, L.aboutText, fb.about.text),
      },
      quote: {
        title: pick(quote?.title, L.quoteTitle, fb.quote.title),
        text: pick(quote?.text, L.quoteText, fb.quote.text),
        button: pick(quote?.button, L.button, fb.quote.button),
      },
    },
    filled,
  };
}
