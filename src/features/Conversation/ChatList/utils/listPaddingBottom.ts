import { MESSAGE_ACTION_BAR_HEIGHT } from '@/const/messageActionPortal';

export const resolveListPaddingBottom = (overlayHeight: number, compact: boolean) =>
  Math.max(24, overlayHeight + 12) + (compact ? MESSAGE_ACTION_BAR_HEIGHT : 0);
