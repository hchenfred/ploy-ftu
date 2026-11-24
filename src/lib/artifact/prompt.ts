// The prompt text for the page and playbook calls, built from what we saved about the business. Pure, no server-only code.
// Everything the site said goes inside <business_data>, which the system prompts treat as data and never as instructions.

export const ARTIFACT_DIGEST_CHARS = 3_000;

export type ArtifactPromptInput = {
  name: string | null;
  domain: string | null;
  summary: string | null;
  description: string | null;
  digest: string | null;
};

/** The user prompt for a page or playbook call. Returns null when there is nothing to base the artifact on. */
export function buildArtifactInput(input: ArtifactPromptInput): string | null {
  const description = input.description?.trim();
  const digest = input.digest?.trim();
  const summary = input.summary?.trim();
  if (!description && !digest && !summary) return null;
  const lines = [
    input.name?.trim() ? `Name: ${input.name.trim()}` : null,
    input.domain?.trim() ? `Website: ${input.domain.trim()}` : null,
    summary ? `Summary: ${summary}` : null,
    description ? `Description written by the user: ${description}` : null,
    digest ? `Website content (excerpt):\n${digest.slice(0, ARTIFACT_DIGEST_CHARS)}` : null,
  ].filter(Boolean);
  return `Write it for this business.\n\n<business_data>\n${lines.join("\n")}\n</business_data>`;
}
