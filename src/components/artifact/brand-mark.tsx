"use client";

import { useState } from "react";

// Only real web images are allowed as a logo: a scraped value could be `javascript:`, `data:` or anything else.
export function isSafeLogoUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// The business logo (hotlinked from its own site) or, when there is none, it fails to load, or the value is not a safe
// https URL, a letter avatar. Never renders model or site text as anything but text.
export function BrandMark({
  name,
  logoUrl,
  className = "size-10",
}: {
  name: string;
  logoUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (isSafeLogoUrl(logoUrl) && !failed) {
    return (
      // Remote logos come from arbitrary domains, so a plain <img> avoids next/image host config.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={(el) => {
          // The logo may already have failed before React attached onError (for example on a server-rendered page).
          if (el && el.complete && el.naturalWidth === 0) setFailed(true);
        }}
        src={logoUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`${className} shrink-0 rounded-lg border border-foreground/10 bg-white object-contain p-1`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="brand-letter"
      className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-foreground font-heading text-background`}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}
