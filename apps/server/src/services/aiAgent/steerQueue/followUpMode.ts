import type { FollowUpBehavior, FollowUpMode, UserGeneralConfig } from '@lobechat/types';
import { resolveFollowUpMode } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:steer-queue:mode');

/**
 * The run owner's Follow-up behavior (Settings → Chat, under the Better Coding
 * Experience lab): what the follow-ups queued behind their run do.
 *
 * - `steer`: join the running turn, merged into one message per join.
 * - `queue`: wait for the run to end and start one turn each.
 * - `legacy`: the lab is off, so the behavior from before the setting.
 *
 * Read when a queue has entries, so a change applies at the next decision
 * point. A read that fails falls back to `legacy`, which is what every run did
 * before the setting existed.
 */
export const readFollowUpMode = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<FollowUpMode> => {
  try {
    const model = new UserModel(db, userId);
    const preference = await model.getUserPreference();
    if (!preference?.lab?.enableBetterCodingExperience) return 'legacy';

    const settings = await model.getUserSettings();
    const general = settings?.general as UserGeneralConfig | undefined;
    return resolveFollowUpMode(true, general?.followUpBehavior as FollowUpBehavior | undefined);
  } catch (error) {
    log('Reading the follow-up behavior of %s failed: %O', userId, error);
    return 'legacy';
  }
};
