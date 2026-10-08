import { RequestTrigger } from '@lobechat/types';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';

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

    /**
     * The parking topic may have been deleted since. `execAgent` reports that
     * either as a result error or by throwing `TopicStartReservationError` —
     * which it also throws for a topic that merely stayed busy. Only a topic
     * that is really gone falls back to a fresh one; a busy topic keeps the
     * outcome in its own conversation and is retried by redelivery.
     */
    const topicGone = async (topicId: string) =>
      !(await new TopicModel(db, userId, workspaceId).findById(topicId));

    let result: Awaited<ReturnType<typeof start>>;
    try {
      result = await start(item.topicId ?? undefined);
    } catch (error) {
      if (
        !(error instanceof TopicStartReservationError) ||
        !item.topicId ||
        !(await topicGone(item.topicId))
      ) {
        throw error;
      }
      result = await start();
    }
    if (result.error && item.topicId && (await topicGone(item.topicId))) result = await start();
    if (result.error) throw new Error(result.error);
  },
});
