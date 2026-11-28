import type { FollowUpBehavior } from '@lobechat/types';

import { getUserStoreState } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

/**
 * The user's Follow-up behavior in effect now: what a message sent while a run
 * is going does. Read at each decision, so a change applies to the next one.
 */
export const getFollowUpMode = (): FollowUpBehavior =>
  userGeneralSettingsSelectors.followUpBehavior(getUserStoreState());

/**
 * Whether, in Steer, a follow-up sent behind a run that can't take messages
 * mid-run stops that run and restarts with it. Read at each decision.
 */
export const getRestartUnsteerableRun = (): boolean =>
  getFollowUpMode() === 'steer' &&
  userGeneralSettingsSelectors.restartUnsteerableRun(getUserStoreState());
