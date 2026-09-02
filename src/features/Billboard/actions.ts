import { isDesktop, isOfficialCloudServer, OFFICIAL_URL } from '@lobechat/const';
import urlJoin from 'url-join';

import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { electronSystemService } from '@/services/electron/system';
import { getElectronStoreState } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
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

export const isBillboardAction = (value: unknown): value is BillboardAction =>
  typeof value === 'string' && (BILLBOARD_ACTIONS as readonly string[]).includes(value);

const isOnOfficialCloud = () => {
  const state = getElectronStoreState();
  if (electronSyncSelectors.isSyncActive(state) && electronSyncSelectors.isOfficialServer(state)) {
    return true;
  }

  return typeof window !== 'undefined' && isOfficialCloudServer(window.location.origin);
};

type BillboardActionGuard = (action: BillboardAction) => BillboardAction | null;

const onlyWhen =
  (target: BillboardAction, available: () => boolean): BillboardActionGuard =>
  (action) =>
    action !== target || available() ? action : null;

/**
 * Availability pipeline: the action flows through each guard, and any guard
 * may drop it to null (the CTA then falls back to `linkUrl`). Add a guard per
 * constraint instead of branching inside `resolveBillboardAction`.
 */
const actionGuards: BillboardActionGuard[] = [onlyWhen('resetOnboarding', isOnOfficialCloud)];

/**
 * Narrow a platform-configured value to an action this client can actually run:
 * unknown values and actions unavailable on the current platform both return
 * null, so the CTA falls back to `linkUrl`.
 */
export const resolveBillboardAction = (value: unknown): BillboardAction | null => {
  if (!isBillboardAction(value)) return null;
  return actionGuards.reduce<BillboardAction | null>(
    (action, guard) => (action ? guard(action) : null),
    value,
  );
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

    if (isDesktop) {
      await electronSystemService.openExternalLink(urlJoin(OFFICIAL_URL, '/onboarding'));
      return;
    }

    window.location.href = '/onboarding';
  },
};

export const runBillboardAction = (action: BillboardAction): Promise<void> | void => {
  return billboardActionHandlers[action]();
};
