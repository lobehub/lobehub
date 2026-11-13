/**
 * Anchors on the 结果交付 page. Sections mark themselves with these data
 * attributes; the rail reads them from the DOM, so a section that renders
 * nothing — or a deliverable group a filter hides — drops out on its own.
 */

export const ANCHOR_ATTR = 'data-result-anchor';
export const ANCHOR_LABEL_ATTR = 'data-result-anchor-label';
export const ANCHOR_LEVEL_ATTR = 'data-result-anchor-level';

/** Below this many anchors the page is short enough to scroll by hand. */
export const MIN_RAIL_ANCHORS = 3;

/**
 * Where a section counts as being read: this far below the scroller's top edge.
 *
 * Kept small on purpose. A section only a few rows high (验收标准 with one
 * criterion, 探索过程 when the work left no trail) never reaches further down,
 * so a deeper line would credit the section *after* the one the reader is on.
 */
export const READING_LINE = 24;

/** Space left above a section the reader jumped to, so its title clears the edge. */
export const JUMP_MARGIN = 16;

export interface ResultAnchor {
  id: string;
  label: string;
  /** 0 for a page section, 1 for a group inside one. */
  level: 0 | 1;
}

export const anchorProps = (id: string, label: string, level: 0 | 1 = 0) => ({
  [ANCHOR_ATTR]: id,
  [ANCHOR_LABEL_ATTR]: label,
  [ANCHOR_LEVEL_ATTR]: level,
});

export const sameAnchors = (a: ResultAnchor[], b: ResultAnchor[]) =>
  a.length === b.length &&
  a.every((anchor, i) => anchor.id === b[i].id && anchor.label === b[i].label);

/**
 * The anchor being read: the last one whose top has passed the reading line,
 * measured against the scroller's viewport. At the bottom of the page the last
 * anchor wins even if it starts lower, so a short closing section can still be
 * highlighted. Returns -1 when there is nothing to mark.
 */
export const pickActiveAnchor = (tops: number[], readingLine: number, atBottom: boolean) => {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let active = 0;
  for (const [i, top] of tops.entries()) {
    if (top <= readingLine) active = i;
    else break;
  }
  return active;
};

/**
 * Where to scroll so a section's top lands `JUMP_MARGIN` below the scroller's
 * top edge, never past either end of the scroll range.
 */
export const jumpScrollTop = (sectionTop: number, scrollTop: number, maxScrollTop: number) =>
  Math.min(Math.max(0, scrollTop + sectionTop - JUMP_MARGIN), Math.max(0, maxScrollTop));
