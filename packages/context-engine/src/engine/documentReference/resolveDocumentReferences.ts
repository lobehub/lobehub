import type { DocumentReferenceItem } from '../../providers/DocumentReferenceContextInjector';

/** Parsed `<refer_document>` tag info */
export interface ParsedDocumentReference {
  documentId: string;
  /** Whether the latest user message carries this tag. */
  latest: boolean;
  title?: string;
}

/** Document lookup result (common interface for client and server sources) */
export interface DocumentLookupResult {
  content?: string | null;
  title?: string | null;
}

/** Character budget per referenced document. */
export const MAX_DOCUMENT_REFERENCE_CHARS = 20_000;
/** Most documents listed for a single request, counted separately for latest and earlier turns. */
export const MAX_DOCUMENT_REFERENCES = 5;

type ReferenceMessage = { content: string | unknown; role?: string };

const findLatestUserIndex = (messages: ReferenceMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return messages.length - 1;
};

/**
 * Parse `<refer_document>` tags from message contents, ordered by last use. The
 * injection is rebuilt on every request, so tags from earlier turns are kept:
 * dropping them would hide that the document was referenced at all.
 */
export function parseReferDocumentTags(messages: ReferenceMessage[]): ParsedDocumentReference[] {
  const refs = new Map<string, ParsedDocumentReference>();
  const latestUserIndex = findLatestUserIndex(messages);

  const hasRoles = messages.some((msg) => msg.role !== undefined);

  messages.forEach((msg, index) => {
    // Only the user writes these tags; an assistant or tool echo must not add
    // or re-order references.
    if (hasRoles && msg.role !== 'user') return;
    // Strip markdown escape backslashes (e.g. \< → <, \_ → _) before parsing
    const raw = typeof msg.content === 'string' ? msg.content : '';
    const content = raw.replaceAll(/\\([<>_*[\]()#`~|])/g, '$1');
    const tagRegex = /<refer_document\s([^>]*)>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      const attrs = tagMatch[1];
      const idMatch = /\bid="([^"]+)"/.exec(attrs);
      if (!idMatch) continue;
      const documentId = idMatch[1];
      const nameMatch = /\bname="([^"]*)"/.exec(attrs);
      const previous = refs.get(documentId);
      // Re-insert so Map order follows the most recent use.
      refs.delete(documentId);
      refs.set(documentId, {
        documentId,
        latest: index === latestUserIndex,
        title: nameMatch?.[1] || previous?.title,
      });
    }
  });

  return [...refs.values()];
}

/**
 * Resolve document references through the provided lookup. Only documents the
 * latest user message references are read and inlined; earlier ones are listed
 * by id so the agent can read them on demand, which keeps a long topic from
 * re-sending every document on every turn. `inlineEarlierTurns` inlines them
 * too, for agents that cannot read documents on demand. A lookup that returns nothing
 * (missing, or not readable by this run) leaves the reference without content.
 */
export async function resolveDocumentReferences(
  messages: ReferenceMessage[],
  lookupDocument: (documentId: string) => Promise<DocumentLookupResult | null | undefined>,
  { inlineEarlierTurns = false }: { inlineEarlierTurns?: boolean } = {},
): Promise<DocumentReferenceItem[] | undefined> {
  const parsed = parseReferDocumentTags(messages);
  if (parsed.length === 0) return undefined;

  const isInlined = (ref: ParsedDocumentReference) => ref.latest || inlineEarlierTurns;
  // Keep the most recent references when a conversation exceeds the cap.
  const earlier = parsed.filter((ref) => !isInlined(ref)).slice(-MAX_DOCUMENT_REFERENCES);
  const latest = parsed.filter(isInlined).slice(-MAX_DOCUMENT_REFERENCES);

  const refs: DocumentReferenceItem[] = earlier.map(({ documentId, title }) => ({
    documentId,
    earlierTurn: true,
    title,
  }));

  for (const { documentId, title } of latest) {
    try {
      const doc = await lookupDocument(documentId);
      const resolvedTitle = doc?.title || title;
      const content = typeof doc?.content === 'string' ? doc.content : undefined;

      if (content === undefined) {
        refs.push({ documentId, title: resolvedTitle });
        continue;
      }

      const truncated = content.length > MAX_DOCUMENT_REFERENCE_CHARS;
      refs.push({
        content: truncated ? content.slice(0, MAX_DOCUMENT_REFERENCE_CHARS) : content,
        documentId,
        title: resolvedTitle,
        ...(truncated && { truncated }),
      });
    } catch {
      refs.push({ documentId, title });
    }
  }

  return refs;
}
