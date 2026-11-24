// Sample data for the artifact previews: normal, partial (what a stream looks like mid-way), empty, and hostile.
// Pure data, no JSX, so the dev fixtures page and the tests share one source.
import type { PageDefinition, PartialPage } from "./page.ts";
import type { PartialPlaybook, Playbook } from "./playbook.ts";
import type { ArtifactProfile } from "./types.ts";

export const PROFILE: ArtifactProfile = {
  name: "Starter Bakery",
  domain: "starterbakery.com",
  summary: "A San Francisco bakery selling fresh bread to locals and cafes.",
  description: null,
  brand: { colors: ["#01468B"], logoUrl: null },
};

export const PROFILE_NO_BRAND: ArtifactProfile = {
  name: null,
  domain: "example-shop.com",
  summary: null,
  description: "We build custom kitchens.",
  brand: {},
};

// What a hostile site or a confused model could put in text. It must only ever be shown as plain text.
export const HOSTILE =
  '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> [click](javascript:window.__pwned=3)';
export const HOSTILE_LOGO = "javascript:window.__pwned=4";
export const LONG_WORD = "Supercalifragilistic".repeat(12); // 240 characters, no spaces

export const PROFILE_HOSTILE: ArtifactProfile = {
  name: HOSTILE,
  domain: null,
  summary: null,
  description: null,
  brand: { colors: ["red; background:url(https://evil.example/x)"], logoUrl: HOSTILE_LOGO },
};

export const PAGE: PageDefinition = {
  hero: {
    headline: "Fresh sourdough for East Bay cafes",
    subhead: "Baked every morning and delivered before you open.",
    cta: "Request a quote",
  },
  benefits: [
    { title: "Baked daily", text: "Every loaf is baked the same morning it ships." },
    { title: "Reliable delivery", text: "Standing orders arrive before opening." },
    { title: "Made to fit", text: "Choose the loaves that suit your menu." },
  ],
  about: { title: "About Starter Bakery", text: "A neighborhood bakery in San Francisco." },
  quote: { title: "Request a wholesale quote", text: "Tell us what your cafe needs.", button: "Send request" },
};
export const PAGE_PARTIAL: PartialPage = { hero: { headline: "Fresh sourdough for East Bay" }, benefits: [{ title: "Baked daily" }] };
export const PAGE_EMPTY: PartialPage = {};
export const PAGE_HOSTILE: PageDefinition = {
  hero: { headline: HOSTILE, subhead: HOSTILE, cta: HOSTILE },
  benefits: [
    { title: HOSTILE, text: HOSTILE },
    { title: LONG_WORD, text: LONG_WORD },
    { title: "Third", text: "Third benefit." },
  ],
  about: { title: HOSTILE, text: HOSTILE },
  quote: { title: HOSTILE, text: HOSTILE, button: HOSTILE },
};

export const PLAYBOOK: Playbook = {
  title: "Spring wholesale launch",
  objective: "Get 20 new wholesale cafes talking to us.",
  audience: "Cafe owners in the Bay Area",
  tasks: [
    { title: "List 50 cafes", detail: "Build a simple spreadsheet of cafes near your shops.", when: "Week 1" },
    { title: "Write the pitch", detail: "Draft a short email that leads with the sourdough.", when: "Week 1" },
    { title: "Send the first batch", detail: "Email ten cafes a day and note every reply.", when: "Week 2" },
    { title: "Offer a tasting", detail: "Drop off a small tasting box to anyone who replies.", when: "Week 3" },
    { title: "Review", detail: "Count replies and tastings, then adjust the pitch.", when: "Week 4" },
  ],
  successMetric: { name: "Qualified replies", target: "Aim for 20 replies", howToMeasure: "Count replies that ask for pricing." },
};
export const PLAYBOOK_PARTIAL: PartialPlaybook = { title: "Spring wholesale launch", tasks: [{ title: "List 50 cafes" }] };
export const PLAYBOOK_EMPTY: PartialPlaybook = {};
export const PLAYBOOK_HOSTILE: Playbook = {
  title: HOSTILE,
  objective: HOSTILE,
  audience: LONG_WORD,
  tasks: [{ title: HOSTILE, detail: HOSTILE, when: HOSTILE }],
  successMetric: { name: HOSTILE, target: HOSTILE, howToMeasure: HOSTILE },
};

// A 1x1 PNG, so the "image" ad renders without any network.
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
