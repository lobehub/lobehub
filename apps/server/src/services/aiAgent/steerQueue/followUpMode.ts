import type { FollowUpBehavior, UserGeneralConfig } from '@lobechat/types';
import { DEFAULT_FOLLOW_UP_BEHAVIOR } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:steer-queue:mode');

/**
 * The run owner's Follow-up behavior (Settings → Chat): what the follow-ups
 * queued behind their run do.
 *
 * - `steer`: join the running turn, merged into one message per join.
 * - `queue`: wait for the run to end and start one turn each.
 *
 * Read when a queue has entries, so a change applies at the next decision
 * point. A read that fails falls back to the default, `steer`.
 */
export const readFollowUpMode = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<FollowUpBehavior> => {
  try {
    const settings = await new UserModel(db, userId).getUserSettings();
    const general = settings?.general as UserGeneralConfig | undefined;
    return general?.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR;
  } catch (error) {
    log('Reading the follow-up behavior of %s failed: %O', userId, error);
    return DEFAULT_FOLLOW_UP_BEHAVIOR;
  }
};
