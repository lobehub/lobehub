import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Resolves the locale a self-iteration run must write user-visible output in.
 *
 * Use when:
 * - A self-iteration handler builds the runtime prompt; proposals, skills and
 *   ideas it produces surface in the owner's inbox and must match their UI
 *   language rather than whatever language the evidence was written in
 *
 * Returns:
 * - The owner's `responseLanguage`, or `undefined` when the lookup fails, so a
 *   settings read error never blocks the run
 */
export const resolveSelfIterationResponseLanguage = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  try {
    const { responseLanguage } = await UserModel.getInfoForAIGeneration(db, userId);

    return responseLanguage;
  } catch {
    return undefined;
  }
};
