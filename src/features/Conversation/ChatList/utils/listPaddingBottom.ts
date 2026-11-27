export const FLOATING_ACTION_TOOLBAR_HEIGHT = 28;

export const resolveListPaddingBottom = (overlayHeight: number, compact: boolean) =>
  Math.max(24, overlayHeight + 12) + (compact ? FLOATING_ACTION_TOOLBAR_HEIGHT : 0);
