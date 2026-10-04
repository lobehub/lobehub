import { RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import type { AgentHumanRequestNotifier } from './index';
import { buildOutcomePrompt } from './outcomePrompt';

/**
 * Production notifier: starts a turn on the agent in the conversation that
 * parked the action, so the outcome lands where the agent asked — whether the
 * owner answered a second later at their desk or hours later on their phone.
 */
export const createAgentHumanRequestNotifier = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): AgentHumanRequestNotifier => ({
  notify: async (item) => {
    const service = new AiAgentService(db, userId, { workspaceId });
    const start = (topicId?: string) =>
      service.execAgent({
        agentId: item.agentId,
        appContext: { scope: 'agent', topicId },
        prompt: buildOutcomePrompt(item),
        trigger: RequestTrigger.Chat,
      });

    let result = await start(item.topicId ?? undefined);
    // The topic may have been deleted since; a fresh one beats a lost outcome.
    if (result.error && item.topicId) result = await start();
    if (result.error) throw new Error(result.error);
  },
});
