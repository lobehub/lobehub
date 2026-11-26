import type { FollowUpBehavior } from '@lobechat/types';

import { getUserStoreState } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

/**
 * The user's Follow-up behavior in effect now: what a message sent while a run
 * is going does. Read at each decision, so a change applies to the next one.
 */
export const getFollowUpMode = (): FollowUpBehavior =>
  userGeneralSettingsSelectors.followUpBehavior(getUserStoreState());
