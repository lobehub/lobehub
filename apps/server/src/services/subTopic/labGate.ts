import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:sub-topic:lab');

/**
 * Whether the user turned on Labs → Better Coding Experience, which gates the
 * `lobe-topic` tool (and, on the client, the sub-topic UI). Opening a sub-topic
 * from the CLI and its completion receipts do not depend on it. A failed read
 * counts as off.
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
