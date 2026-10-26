export const acceptanceContentLayout = {
  // GitHub's PR page width: the discussion keeps a full-width feed beside a
  // fixed aside that sits on the container's right edge.
  maxWidth: 1280,
  paddingInline: 24,
} as const;

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
