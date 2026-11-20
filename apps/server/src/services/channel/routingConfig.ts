import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { SystemAgentItem, UserSystemAgentConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';

/**
 * Routing is enabled by default; enabled:false always opts out.
 * SYSTEM_AGENT=default=... never assigns a chat model to this decision-only slot.
 * Credentials still resolve as the actual message sender in the Channel's workspace.
 */
export const resolveChannelRoutingConfig = async (db: LobeChatDatabase, userId: string) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
  const task: Partial<SystemAgentItem> | undefined = systemAgent?.channelRouting;
  const deployment = parseSystemAgent(appEnv.SYSTEM_AGENT).channelRouting;
  const defaults = DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting;
  const enabled = task?.enabled ?? defaults.enabled;
  if (!enabled) return null;
  return {
    model: task?.model || deployment?.model || defaults.model,
    provider: task?.provider || deployment?.provider || defaults.provider,
  };
};
