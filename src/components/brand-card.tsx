"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { BrandProfile } from "@/lib/tools/research-site"; // type-only: erased, never loads the server module

// What the agent learned about the business: logo, name, colors, fonts.
export function BrandCard({ brand, domain }: { brand: BrandProfile; domain: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const name = brand.name ?? domain;
  const showLogo = brand.logoUrl && !logoFailed;

  return (
    <section
      aria-label={`Brand for ${name}`}
      className="flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-white p-5"
    >
      <div className="flex items-center gap-3">
        {showLogo ? (
          // Remote logos come from arbitrary domains, so a plain <img> avoids next/image host config.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl!}
            alt={`${name} logo`}
            className="size-12 rounded-lg border border-foreground/10 bg-white object-contain p-1"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-lg bg-foreground font-heading text-xl text-background"
          >
            {name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate font-heading text-lg font-semibold">{name}</h2>
          <p className="truncate text-sm text-foreground/70">{domain}</p>
        </div>
      </div>

      {brand.colors.length > 0 && (
        <ul aria-label="Brand colors" className="flex flex-wrap gap-3">
          {brand.colors.map((hex) => (
            <li key={hex} className="flex items-center gap-2 text-xs text-foreground/70">
              <span
                aria-hidden="true"
                className="size-6 rounded-full border border-foreground/15"
                style={{ backgroundColor: hex }}
              />
              {hex.toUpperCase()}
            </li>
          ))}
        </ul>
      )}

      {brand.fonts.length > 0 && (
        <p className="text-sm text-foreground/70">
          <span className="font-medium text-foreground">Fonts:</span> {brand.fonts.join(", ")}
        </p>
      )}

      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="size-4" aria-hidden="true" />
        Brand saved
      </p>
    </section>
  );
}
