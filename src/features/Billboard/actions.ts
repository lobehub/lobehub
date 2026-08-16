import { isDesktop, OFFICIAL_URL } from '@lobechat/const';
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

/**
 * Narrow a platform-configured value to an action this client can actually run:
 * unknown values and actions unavailable on the current platform both return
 * null, so the CTA falls back to `linkUrl`.
 *
 * `resetOnboarding` targets the web onboarding flow, which only exists on the
 * official cloud instance. Desktop honors it only when synced to official
 * cloud (the reset then applies to that account and the flow opens at
 * OFFICIAL_URL in the external browser); local and self-host modes keep it
 * disabled since their reset would not match what the browser shows.
 */
export const resolveBillboardAction = (value: unknown): BillboardAction | null => {
  if (!isBillboardAction(value)) return null;
  if (value === 'resetOnboarding' && isDesktop && !isSyncedToOfficialCloud()) return null;
  return value;
};

const isSyncedToOfficialCloud = () => {
  const state = getElectronStoreState();
  return (
    electronSyncSelectors.isSyncActive(state) &&
    electronSyncSelectors.storageMode(state) === 'cloud'
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
