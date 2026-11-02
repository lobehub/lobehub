import type { QuickNoteProposal, QuickNoteResource } from '@/services/quickNote';

/** Where a write-document (`tool_call`) Proposal writes. */
export interface QuickNoteProposalWriteTarget {
  /** Page title, or `undefined` when unknown (the caller shows an "untitled" label). */
  title?: string;
  /** `append` adds to an existing Page; `create` makes a new private Page. */
  type: 'append' | 'create';
}

const TITLE_MAX_LENGTH = 60;

/** First non-empty line, bounded, since a resource label can fall back to document content. */
const toTitle = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const line = value
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH)}…` : line;
};

/**
 * Resolves the Page a write-document Proposal targets, for the card's "Append to" / "New page"
 * line.
 *
 * Use when:
 * - Rendering a `tool_call` Proposal.
 *
 * Expects:
 * - An append draft may only target a Document or Page linked to the note, so its title is read
 *   from the note's resources.
 *
 * Before:
 * - `({ payload: { documentId: "doc-1" } }, [{ resourceId: "doc-1", label: "Moshi research" }])`
 *
 * After:
 * - `{ type: "append", title: "Moshi research" }`
 *
 * Returns:
 * - `undefined` for every other Proposal kind.
 */
export const resolveProposalWriteTarget = (
  proposal: Pick<QuickNoteProposal, 'kind' | 'payload'>,
  resources: Pick<QuickNoteResource, 'label' | 'resourceId' | 'resourceType'>[],
): QuickNoteProposalWriteTarget | undefined => {
  if (proposal.kind !== 'tool_call') return undefined;

  const documentId = proposal.payload.documentId;
  if (typeof documentId === 'string' && documentId) {
    const resource = resources.find(
      ({ resourceId, resourceType }) =>
        resourceId === documentId && (resourceType === 'document' || resourceType === 'page'),
    );
    return { title: toTitle(resource?.label), type: 'append' };
  }

  return { title: toTitle(proposal.payload.title), type: 'create' };
};
