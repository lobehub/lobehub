import { isDesktop } from '@lobechat/const';

import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { getUserStoreState } from '@/store/user';

/**
 * In-app CTA actions a billboard item can trigger. The platform configures one
 * of these enum values in the item's `action` field; the client runs the
 * registered handler instead of opening `linkUrl`.
 *
 * Keep in sync with the ops platform enum (`src/const/billboard.ts` in lobe-ops).
 */
export const BILLBOARD_ACTIONS = ['openChangelog', 'openFeedback', 'resetOnboarding'] as const;

export type BillboardAction = (typeof BILLBOARD_ACTIONS)[number];

/** Actions only meaningful on the web SPA (desktop has its own onboarding flow). */
const WEB_ONLY_ACTIONS: readonly BillboardAction[] = ['resetOnboarding'];

export const isBillboardAction = (value: unknown): value is BillboardAction =>
  typeof value === 'string' && (BILLBOARD_ACTIONS as readonly string[]).includes(value);

/**
 * Narrow a platform-configured value to an action this client can actually run:
 * unknown values and actions unavailable on the current platform both return
 * null, so the CTA falls back to `linkUrl`.
 */
export const resolveBillboardAction = (value: unknown): BillboardAction | null => {
  if (!isBillboardAction(value)) return null;
  if (isDesktop && WEB_ONLY_ACTIONS.includes(value)) return null;
  return value;
};

const billboardActionHandlers: Record<BillboardAction, () => Promise<void> | void> = {
  openChangelog: () => {
    openChangelogModal();
  },
  openFeedback: () => {
    openFeedbackModal();
  },
  resetOnboarding: async () => {
    await getUserStoreState().resetOnboarding();
    window.location.href = '/onboarding';
  },
};

export const runBillboardAction = (action: BillboardAction): Promise<void> | void => {
  return billboardActionHandlers[action]();
};
