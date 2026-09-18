// Product context snapshots for experiments created from a product.
//
// PRODUCT_CONTEXT.md is a compact, human-readable snapshot of the product at
// the moment the experiment was created: enough to work standalone in any
// harness, never a dump of the repo, chat history, or giant generated
// context. Agents (and people) read it on demand; it is never attached to
// prompts automatically.
import type { FourSpacesEnvironmentState } from "./registry.ts";

export const PRODUCT_CONTEXT_FILENAME = "PRODUCT_CONTEXT.md";

export interface ProductContextSource {
  readonly path: string;
  readonly contents: string | null;
}

/** Sources consulted, in order. First hit wins per file; all are optional. */
export const PRODUCT_CONTEXT_SOURCES: ReadonlyArray<string> = [
  "README.md",
  "AGENTS.md",
  "NOTES.md",
  "product-memory.md",
];

const MAX_CHARS_PER_SOURCE = 2000;
const MAX_TOTAL_CHARS = 6000;

function truncateSection(contents: string): { text: string; truncated: boolean } {
  const trimmed = contents.trim();
  if (trimmed.length <= MAX_CHARS_PER_SOURCE) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, MAX_CHARS_PER_SOURCE).trimEnd(), truncated: true };
}

/**
 * Build the PRODUCT_CONTEXT.md body, or null when no source had anything to
 * say (no empty file litter). Skips missing and blank sources.
 */
export function buildProductContext(input: {
  readonly productTitle: string;
  readonly productRoot: string;
  readonly experimentName: string;
  readonly createdAt: string;
  readonly sources: ReadonlyArray<ProductContextSource>;
}): string | null {
  const sections: string[] = [];
  let total = 0;
  for (const source of input.sources) {
    if (source.contents === null || source.contents.trim().length === 0) continue;
    if (total >= MAX_TOTAL_CHARS) break;
    const { text, truncated } = truncateSection(source.contents);
    const room = MAX_TOTAL_CHARS - total;
    const clipped = text.length > room ? text.slice(0, room).trimEnd() : text;
    sections.push(
      `## From ${source.path}\n\n${clipped}${truncated || clipped.length < text.length ? "\n\n*(truncated)*" : ""}`,
    );
    total += clipped.length;
  }
  if (sections.length === 0) return null;
  return [
    `# Product context: ${input.productTitle}`,
    ``,
    `Snapshot for experiment “${input.experimentName}” (${input.createdAt}).`,
    `Source workspace: \`${input.productRoot}\``,
    ``,
    ...sections.flatMap((section) => [section, ``]),
  ]
    .join("\n")
    .trimEnd();
}

/** Experiments whose originProductId points at the given product workspace. */
export function selectRelatedExperiments(
  state: FourSpacesEnvironmentState,
  productWorkspaceId: string,
): ReadonlyArray<{
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly projectId: string | null;
}> {
  return state.entries
    .filter((entry) => entry.kind === "experiment" && entry.originProductId === productWorkspaceId)
    .map((entry) => ({
      workspaceId: entry.workspaceId,
      workspaceRoot: entry.workspaceRoot,
      projectId: entry.projectId ?? null,
    }));
}
