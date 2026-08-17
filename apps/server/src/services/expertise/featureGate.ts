import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Keeps model-visible expertise behind the existing Self Learning Lab switch.
 * The default is deliberately disabled, including when the preference cannot be read.
 */
export const isExpertiseInjectionEnabledForUser = async (db: LobeChatDatabase, userId: string) => {
  try {
    const preference = await new UserModel(db, userId).getUserPreference();

    return preference?.lab?.enableSelfLearning === true;
  } catch (error) {
    console.error('Failed to resolve expertise injection Lab preference:', error);
    return false;
  }
};
