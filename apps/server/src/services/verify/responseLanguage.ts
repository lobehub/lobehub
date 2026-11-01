import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * The language verify text must be written in: the account's explicit
 * `responseLanguage`, the same setting `lh acceptance` enforces on what a
 * builder publishes. Criteria and reports render on the owner's acceptance
 * page, so they follow the owner, not the language of a Task's run goal.
 *
 * Returns `undefined` when the setting is unset or unreadable, so the prompt
 * falls back to the goal's own language and a settings read never blocks a run.
 */
export const resolveVerifyResponseLanguage = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  try {
    const settings = await new UserModel(db, userId).getUserSettings();
    const value = (settings?.general as { responseLanguage?: unknown } | null | undefined)
      ?.responseLanguage;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};
