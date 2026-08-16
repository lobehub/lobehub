import { isDesktop } from '@lobechat/const';
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
 * `resetOnboarding` targets the web onboarding flow. Desktop can only honor it
 * when synced to a remote server (the reset then applies to that account and
 * the flow opens in the external browser); in local mode the reset would hit
 * the local DB while the browser shows a different account, so it stays
 * disabled there.
 */
export const resolveBillboardAction = (value: unknown): BillboardAction | null => {
  if (!isBillboardAction(value)) return null;
  if (
    value === 'resetOnboarding' &&
    isDesktop &&
    !electronSyncSelectors.isSyncActive(getElectronStoreState())
  )
    return null;
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

    if (isDesktop) {
      const remoteServerUrl = electronSyncSelectors.remoteServerUrl(getElectronStoreState());
      await electronSystemService.openExternalLink(urlJoin(remoteServerUrl, '/onboarding'));
      return;
    }

    window.location.href = '/onboarding';
  },
};

export const runBillboardAction = (action: BillboardAction): Promise<void> | void => {
  return billboardActionHandlers[action]();
};
