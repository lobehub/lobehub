import type { DocumentCommentAnchorItem, DocumentCommentSelectionAnchor } from '@lobechat/types';

import type { AnchorMatch, FlattenedText } from './textAnchor';
import { locateAnchor } from './textAnchor';

/**
 * Two roots quoting the same run at the same offset resolve identically, so
 * the body is scanned once per distinct anchor rather than once per thread.
 */
const anchorKey = ({ prefix = '', quote, start, suffix = '' }: DocumentCommentSelectionAnchor) =>
  `${start}\u0001${prefix}\u0001${quote}\u0001${suffix}`;

/**
 * Resolutions keyed by the body text they were made against. A body update
 * that changed no text (formatting, an attribute, a caret) reuses every result
 * outright; only an actual edit pays for a scan, and even then only once per
 * distinct anchor. Orphaned anchors are the expensive ones — they miss the
 * offset fast path and fall through to a full `indexOf` — so not re-scanning
 * them for nothing matters most on a document that has accumulated many
 * retained comments.
 */
export interface AnchorResolveCache {
  results: ReadonlyMap<string, AnchorMatch | null>;
  text: string;
}

export const EMPTY_ANCHOR_RESOLVE_CACHE: AnchorResolveCache = { results: new Map(), text: '' };

export interface ResolvedAnchors {
  cache: AnchorResolveCache;
  /** Root id → where its quote sits in the body now. */
  matches: ReadonlyMap<string, AnchorMatch>;
  /** Roots whose quote is no longer in the body. */
  orphaned: ReadonlySet<string>;
}

/** Locate every anchor against the body, reusing `previous` where the text is unchanged. */
export const resolveAnchors = (
  flat: FlattenedText,
  entries: readonly DocumentCommentAnchorItem[],
  previous: AnchorResolveCache = EMPTY_ANCHOR_RESOLVE_CACHE,
): ResolvedAnchors => {
  const matches = new Map<string, AnchorMatch>();
  const orphaned = new Set<string>();
  const results = new Map<string, AnchorMatch | null>();
  const reusable = previous.text === flat.text;

  for (const { id: rootId, selectionAnchor } of entries) {
    const key = anchorKey(selectionAnchor);
    let match = results.get(key);
    if (match === undefined) {
      match =
        reusable && previous.results.has(key)
          ? previous.results.get(key)!
          : locateAnchor(flat, selectionAnchor);
      results.set(key, match);
    }
    if (match) matches.set(rootId, match);
    else orphaned.add(rootId);
  }

  return { cache: { results, text: flat.text }, matches, orphaned };
};
