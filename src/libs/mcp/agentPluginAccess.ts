import { getDisabledPluginIds } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/** Read live agent preferences so disabling a service also stops queued/direct calls. */
export const readDisabledAgentPlugins = async (
  db: LobeChatDatabase,
  agentId: string,
  lockRows = false,
) => {
  const query = db
    .select({ plugins: agents.plugins })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  const [agent] = await (lockRows ? query.for('share') : query);
  return agent ? getDisabledPluginIds(agent.plugins ?? undefined) : undefined;
};

export const isAgentPluginDisabled = async (
  db: LobeChatDatabase,
  agentId: string,
  identifier: string,
  lockRows = false,
) => {
  const disabled = await readDisabledAgentPlugins(db, agentId, lockRows);
  return !disabled || disabled.includes(identifier);
};
