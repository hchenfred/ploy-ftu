import "server-only";
import { tool } from "ai";
import { z } from "zod";
import Firecrawl, { type BrandingProfile } from "@mendable/firecrawl-js";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { advanceStatus } from "@/lib/session-state";
import { normalizeUrl } from "@/lib/url";

const TIMEOUT_MS = 30_000;
const DIGEST_CHARS = 6_000;

export type BrandProfile = {
  name: string | null;
  logoUrl: string | null;
  colors: string[]; // hex, max 5
  fonts: string[]; // max 3
};

export type ResearchFailureReason = "timeout" | "blocked" | "invalid_url" | "empty" | "unknown";

export type ResearchSiteOutput =
  | { ok: true; domain: string; brand: BrandProfile; contentDigest: string }
  | { ok: false; reason: ResearchFailureReason };

// The tool is built per request so `execute` knows the session from the server,
// not from the model. The LLM only ever supplies the URL.
export function researchSiteTool(sessionId: string) {
  return tool({
    description:
      "Read the user's website: extract brand (name, logo, colors, fonts) and page content. Call once when the user gives a website or domain.",
    inputSchema: z.object({
      url: z.string().min(3).describe("The website or domain the user gave, e.g. starterbakery.com"),
    }),
    // Never throws: every failure becomes { ok: false, reason } so the agent can take the fallback path.
    execute: async ({ url }): Promise<ResearchSiteOutput> => {
      const started = Date.now();

      const fail = async (reason: ResearchFailureReason, detail?: string) => {
        await logEvent(sessionId, "tool_failed", { tool: "researchSite", reason, detail });
        return { ok: false as const, reason };
      };

      const normalized = normalizeUrl(url);
      if (!normalized.ok) return fail("invalid_url");

      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) return fail("unknown", "FIRECRAWL_API_KEY missing");

      let markdown = "";
      let branding: BrandingProfile | undefined;
      let title: string | undefined;
      try {
        const firecrawl = new Firecrawl({ apiKey });
        const doc = await withTimeout(
          firecrawl.scrape(normalized.url, {
            formats: ["branding", "markdown"],
            onlyMainContent: true,
            timeout: TIMEOUT_MS,
          }),
          TIMEOUT_MS + 2_000,
        );
        markdown = doc.markdown ?? "";
        branding = doc.branding;
        title = doc.metadata?.title;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "timeout" || /timed? ?out/i.test(message)) return fail("timeout", message);
        if (/40[13]|blocked|forbidden/i.test(message)) return fail("blocked", message);
        return fail("unknown", message);
      }

      const brand = toBrandProfile(branding, title);
      if (!markdown.trim() && brand.colors.length === 0) return fail("empty");

      const contentDigest = markdown.slice(0, DIGEST_CHARS);

      const { error } = await supabaseAdmin()
        .from("business_profiles")
        .upsert({
          session_id: sessionId,
          url: normalized.url,
          name: brand.name,
          brand,
          content: { digest: contentDigest },
          field_sources: { name: "scraped", brand: "scraped" },
          // A fresh research starts the profile over: never keep an earlier site's goals.
          summary: null,
          suggested_goals: null,
          updated_at: new Date().toISOString(),
        });
      if (error) console.error("[researchSite] failed to save profile:", error.message);

      await logEvent(sessionId, "research_done", {
        ok: true,
        ms: Date.now() - started,
        domain: normalized.domain,
      });

      // The server moves the session to the goal step; the UI re-reads the status when the user clicks Continue.
      await advanceStatus(sessionId, "site", "goal");

      return { ok: true, domain: normalized.domain, brand, contentDigest };
    },
  });
}

function toBrandProfile(b: BrandingProfile | undefined, title?: string): BrandProfile {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const colorOrder = ["primary", "secondary", "accent", "background", "textPrimary"];
  const colorValues = b?.colors
    ? [...colorOrder.map((k) => b.colors?.[k]), ...Object.values(b.colors)]
    : [];
  const colors = unique(colorValues.filter((c): c is string => !!c && hex.test(c))).slice(0, 5);

  const fontValues = [
    ...(b?.fonts?.map((f) => f.family) ?? []),
    ...Object.values(b?.typography?.fontFamilies ?? {}),
  ];
  const fonts = unique(fontValues.filter((f): f is string => !!f)).slice(0, 3);

  const fallbackName = title?.split(/\s[|\-–—]\s/)[0]?.trim() || null;

  return {
    name: b?.brandName?.trim() || fallbackName,
    logoUrl: b?.logo ?? null,
    colors,
    fonts,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
