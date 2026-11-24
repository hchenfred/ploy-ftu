import { clip } from "../goals.ts";
import { normalizeAccent } from "./theme.ts";

// The `launch_product` ad. The ad needs no model call: the headline is the user's own text or the business name (never an
// invented offer), the image prompt is a fixed template, and the image comes from fal (or a text-only branded card).
export type AdCreative = {
  kind: "ad_creative";
  source: "fal" | "card"; // "card" = the text-only branded card
  headline: string;
  accent: string; // brand accent color, 6-digit hex
};

export const AD_HEADLINE_MAX = 60;

// Remove control characters and collapse whitespace so a headline stays one clean line.
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** The user's headline verbatim (cleaned, at most 60 characters), otherwise the business name, otherwise a neutral word. */
export function buildAdHeadline(userHeadline: string | null | undefined, businessName: string | null | undefined): string {
  const mine = clip(clean(userHeadline ?? ""), AD_HEADLINE_MAX);
  if (mine) return mine;
  const name = clip(clean(businessName ?? ""), AD_HEADLINE_MAX);
  return name || "Our product";
}

/**
 * The fixed prompt for the image model. It only ever contains the headline text and an accent color, so it can never
 * contain an offer, a price or a claim the user did not type. Both inputs are made safe here, not trusted from the
 * caller: the headline is cleaned, cut to 60 characters and its quotes softened (so they cannot end the quoted headline
 * early), and the accent must be a valid hex color, otherwise it becomes the ink color (so arbitrary text can never be
 * pasted into the prompt).
 */
export function buildImagePrompt({ headline, accent }: { headline: string; accent: string }): string {
  const safe = clip(clean(headline), AD_HEADLINE_MAX).replace(/["“”]/g, "'");
  accent = normalizeAccent(accent);
  return [
    "Keep the product in the reference photo exactly as it is: the same shape, colors, label and packaging.",
    "Do not change, redraw or invent the product.",
    `Place it in a clean, bright, professional advertising scene with soft natural light and a simple background that suits the color ${accent}.`,
    `Add the headline "${safe}" as large, clean, easy-to-read text, spelled exactly as written, placed where it does not cover the product.`,
    "No other text, logos, prices or offers.",
  ].join(" ");
}

export type ImageType = "jpeg" | "png" | "webp";

/** The real image type from the first bytes of a file (the filename and declared type are never trusted), or null. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export const imageExtension = (t: ImageType) => (t === "jpeg" ? "jpg" : t);
export const imageContentType = (t: ImageType) => `image/${t}`;
