// Brand color handling for the previews. Pure, no server-only code.

const INK = "#141414";

/** "#abc" or "#aabbcc" (any case) to [r, g, b]; anything else (8 digits, names, junk) is rejected. */
export function parseHex(input: unknown): [number, number, number] | null {
  if (typeof input !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = ([r, g, b]: [number, number, number]) =>
  "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

/** Any value to a safe 6-digit lowercase hex: valid 3 or 6 digit hex is normalized, everything else becomes the ink color. */
export function normalizeAccent(input: unknown): string {
  const rgb = parseHex(input);
  return rgb ? toHex(rgb) : INK;
}

/**
 * The accent color for buttons and highlights: the first brand color that gives white text at least 4.5:1 contrast,
 * otherwise the M1 ink color. Always returns a 6-digit lowercase hex and white-on-accent text.
 */
export function deriveTheme(colors: ReadonlyArray<unknown> | null | undefined): { accent: string; onAccent: string } {
  const white: [number, number, number] = [255, 255, 255];
  for (const c of colors ?? []) {
    const rgb = parseHex(c);
    if (rgb && contrastRatio(rgb, white) >= 4.5) return { accent: toHex(rgb), onAccent: "#ffffff" };
  }
  return { accent: INK, onAccent: "#ffffff" };
}
