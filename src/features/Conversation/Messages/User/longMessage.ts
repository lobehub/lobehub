import { GOAL_TURN_TAG } from '@/const/plugin';

/** Past this many characters a user message renders as a short preview. */
export const LONG_MESSAGE_THRESHOLD = 30_000;

/**
 * Whether a user message should render as the short plain preview instead of
 * full markdown. A goal manager turn is exempt: its card already folds and
 * clamps the long parts, while the preview reparses a 1,000-character slice
 * without the card plugin, so a feedback-heavy turn would never show its card.
 */
export const shouldPreviewLongMessage = (text: string) =>
  text.length > LONG_MESSAGE_THRESHOLD && !text.trimStart().startsWith(`<${GOAL_TURN_TAG}`);
