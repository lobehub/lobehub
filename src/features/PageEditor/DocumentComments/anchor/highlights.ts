import type { AnchorMatch, FlattenedText } from './textAnchor';
import { buildAnchorRange } from './textAnchor';

/**
 * CSS Custom Highlight registry names. One registry per visual weight rather
 * than one per comment: the API resolves overlaps by `priority`, so the active
 * thread simply outranks the resting paint without any per-range bookkeeping.
 */
export const HIGHLIGHT_REGISTRY = {
  /** Every resolved anchor on the page. */
  all: 'lobe-document-comment',
  /** The thread the reader is pointing at, from either side. */
  active: 'lobe-document-comment-active',
  /** The selection being composed, before it becomes a comment. */
  pending: 'lobe-document-comment-pending',
} as const;

const PRIORITY = { active: 3, all: 1, pending: 2 } as const;

/**
 * Highlights are painted through the CSS Custom Highlight API instead of mark
 * nodes or absolutely positioned overlays.
 *
 * A mark node would mean editing the document to comment on it — polluting the
 * markdown export, fighting the collaborative Yjs doc, and needing a write-back
 * whenever a comment is deleted. An overlay would need re-measuring on every
 * reflow. Highlight ranges own no DOM at all and follow the text for free.
 */
export const supportsHighlightApi = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

const setRegistry = (name: string, ranges: Range[], priority: number) => {
  if (!supportsHighlightApi()) return;
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const highlight = new Highlight(...ranges);
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
};

export const clearCommentHighlights = () => {
  if (!supportsHighlightApi()) return;
  for (const name of Object.values(HIGHLIGHT_REGISTRY)) CSS.highlights.delete(name);
};

interface PaintParams {
  activeRootId: string | null;
  flat: FlattenedText;
  matches: ReadonlyMap<string, AnchorMatch>;
  pending: AnchorMatch | null;
}

/** Repaint every registry from the currently resolved matches. */
export const paintCommentHighlights = ({
  activeRootId,
  flat,
  matches,
  pending,
}: PaintParams): void => {
  if (!supportsHighlightApi()) return;

  const resting: Range[] = [];
  const active: Range[] = [];

  for (const [rootId, match] of matches) {
    const range = buildAnchorRange(flat, match);
    if (!range) continue;
    resting.push(range);
    if (rootId === activeRootId) active.push(range);
  }

  const pendingRange = pending ? buildAnchorRange(flat, pending) : null;

  setRegistry(HIGHLIGHT_REGISTRY.all, resting, PRIORITY.all);
  setRegistry(HIGHLIGHT_REGISTRY.active, active, PRIORITY.active);
  setRegistry(HIGHLIGHT_REGISTRY.pending, pendingRange ? [pendingRange] : [], PRIORITY.pending);
};
