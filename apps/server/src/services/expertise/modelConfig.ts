import type { UserSystemAgentConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

export const resolveExpertiseModelConfig = async (db: LobeChatDatabase, userId: string) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;

  return resolveSystemAgentModelConfig({
    taskConfig: systemAgent?.expertise,
    taskKey: 'expertise',
  });
};
