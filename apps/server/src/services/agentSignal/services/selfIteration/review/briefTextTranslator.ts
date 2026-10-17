import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { translation } from '@/libs/i18n/serverTranslation';

import type { SelfReviewBriefTextTranslator } from './briefText';

/**
 * Resolves the `home` namespace translator used to render persisted nightly
 * self-review Daily Brief text in the brief owner's response language.
 *
 * Use when:
 * - A server path projects a nightly self-review Daily Brief (in-run proposal
 *   tool, or the completion-side ideas brief)
 *
 * Returns:
 * - A translator for the user's response language, defaulting to en-US
 */
export const resolveSelfReviewBriefTextTranslator = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<SelfReviewBriefTextTranslator> => {
  const userInfo = await UserModel.getInfoForAIGeneration(db, userId);
  const { t } = await translation('home', userInfo.responseLanguage ?? 'en-US');

  return t;
};
