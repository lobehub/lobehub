import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';

/**
 * In-app CTA actions a billboard item can trigger. The platform configures one
 * of these enum values in the item's `action` field; the client runs the
 * registered handler instead of opening `linkUrl`.
 */
export const BILLBOARD_ACTIONS = ['openChangelog', 'openFeedback'] as const;

export type BillboardAction = (typeof BILLBOARD_ACTIONS)[number];

export const isBillboardAction = (value: unknown): value is BillboardAction =>
  typeof value === 'string' && (BILLBOARD_ACTIONS as readonly string[]).includes(value);

const billboardActionHandlers: Record<BillboardAction, () => void> = {
  openChangelog: () => openChangelogModal(),
  openFeedback: () => openFeedbackModal(),
};

export const runBillboardAction = (action: BillboardAction): void => {
  billboardActionHandlers[action]();
};
