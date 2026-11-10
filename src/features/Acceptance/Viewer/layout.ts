export const acceptanceContentLayout = {
  // GitHub's PR page width: the discussion keeps a full-width feed beside a
  // fixed aside that sits on the container's right edge.
  maxWidth: 1280,
  paddingInline: 24,
} as const;

/** The checklist reads as one column of evidence, not a feed with an aside —
 * it keeps the narrower reading width inside the page's wide frame. */
export const acceptanceChecksLayout = {
  maxWidth: 920,
} as const;

/** The checklist's measure with the column's own padding added back, so the
 * content inside lands on exactly that width. The header always uses it: the
 * title and tabs must stay put when the reader switches tabs. */
export const acceptanceReadingColumnMaxWidth =
  acceptanceChecksLayout.maxWidth + 2 * acceptanceContentLayout.paddingInline;

/** Only the discussion has an aside to make room for. */
export const getAcceptanceBodyMaxWidth = (tab: string) =>
  tab === 'discussion' ? acceptanceContentLayout.maxWidth : acceptanceReadingColumnMaxWidth;

export const acceptanceFocusedLayout = {
  contentPaddingBlock: '32px 24px',
  headerGap: 8,
  outlineItemPaddingBlock: 10,
  outlineItemPaddingInline: 8,
} as const;

export const acceptanceScrollLayout = {
  frameOverflow: 'auto',
  paneOverflow: 'visible',
} as const;
