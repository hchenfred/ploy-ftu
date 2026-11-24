"use client";

import { useState } from "react";
import { normalizeAccent } from "@/lib/artifact/theme";
import { BrandMark } from "./brand-mark";

// The ad creative. With a generated image it shows the image (the headline is already in it); otherwise, or if the image
// fails to load, it shows the text-only branded card: the brand accent, the business name and the headline. The accent
// is re-validated here, so a bad value can never reach an inline style. Missing fields never produce a blank card.
export function AdCard({
  headline,
  accent,
  name,
  logoUrl,
  imageUrl,
}: {
  headline?: string | null;
  accent?: string | null;
  name: string;
  logoUrl?: string | null;
  /** A signed URL of our stored copy of the generated image, or null for the text-only card. */
  imageUrl?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = normalizeAccent(accent);
  const text = (headline ?? "").trim() || name;

  if (imageUrl && !imageFailed) {
    return (
      <figure aria-label="Ad creative" className="m-0 overflow-hidden rounded-2xl border border-foreground/10 bg-white">
        {/* A signed URL of our own storage, so a plain <img> is enough. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={(el) => {
            // The image may already have failed before React attached onError (for example on a server-rendered page).
            if (el && el.complete && el.naturalWidth === 0) setImageFailed(true);
          }}
          src={imageUrl}
          alt={`Ad for ${name}: ${text}`}
          className="aspect-square w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </figure>
    );
  }
  return (
    <figure
      aria-label="Ad creative"
      data-testid="ad-card-text"
      className="m-0 flex aspect-square w-full flex-col justify-between overflow-hidden rounded-2xl p-6 [overflow-wrap:anywhere]"
      style={{ backgroundColor: color, color: "#ffffff" }}
    >
      <BrandMark name={name} logoUrl={logoUrl} className="size-10" />
      <p className="font-heading text-3xl font-semibold leading-tight tracking-tight">{text}</p>
      <figcaption className="text-sm opacity-90">{name}</figcaption>
    </figure>
  );
}
