import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:sub-topic:lab');

/**
 * Whether the user turned on Labs → Better Coding Experience, which owns
 * everything sub-topics add on top of the `metadata.openedBy` link: the
 * `lobe-topic` tool, completion receipts and the sidebar hierarchy. The link
 * itself is always written. A failed read counts as off, so nothing new
 * happens for a user whose preference cannot be read.
 */
export const readSubTopicsEnabled = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<boolean> => {
  try {
    const preference = await new UserModel(db, userId).getUserPreference();
    return preference?.lab?.enableBetterCodingExperience === true;
  } catch (error) {
    log('Reading the Better Coding Experience lab of %s failed: %O', userId, error);
    return false;
  }
};
