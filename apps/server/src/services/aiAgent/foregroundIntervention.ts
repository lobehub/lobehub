import type { UserInterventionConfig, UserToolConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Approval policy for a run the server starts to continue a user-facing
 * conversation on its own (a finished task or background sub-agent reporting
 * back): the same preferences as a foreground send, including the allow list.
 * The user's `headless` preference maps to `auto-run`, which still honours
 * per-tool requirements a run with nobody watching cannot skip.
 */
export const resolveForegroundInterventionConfig = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserInterventionConfig> => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const intervention = (settings?.tool as UserToolConfig | undefined)?.humanIntervention;
  const approvalMode =
    intervention?.approvalMode === 'headless'
      ? 'auto-run'
      : (intervention?.approvalMode ?? 'manual');

  return { allowList: intervention?.allowList ?? [], approvalMode };
};
