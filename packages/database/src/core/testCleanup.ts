import { inArray } from 'drizzle-orm';

import { releaseProjectEnvironments } from '../models/utils/projectEnvironmentCleanup';
import { environmentInstances, environments, projectEnvironments, users } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Deletes test users the way account deletion does: every project has its own
 * environment, and `environments.user_id` is `restrict`, so the environments of
 * the users' projects are released first. Without ids, every user goes, and so
 * does every environment.
 */
export const deleteTestUsers = async (db: LobeChatDatabase, ids?: string[]) => {
  if (ids) {
    for (const userId of ids) await releaseProjectEnvironments(db, { userId });
    await db.delete(users).where(inArray(users.id, ids));
    return;
  }

  // A test that deleted a project directly leaves its environment behind,
  // standalone, still holding its user: every environment goes.
  await db.delete(projectEnvironments);
  await db.delete(environmentInstances);
  await db.delete(environments);
  await db.delete(users);
};
