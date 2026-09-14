import { TopicModel } from '@/database/models/topic';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

/**
 * Placeholders for the LobeHub builtin skill
 * (`packages/builtin-skills/src/lobehub/content.ts`) so it can render
 * `{{agent_id}}` / `{{agent_title}}` / `{{topic_id}}` etc. into the model's
 * prompt without a separate context injector. The topic title is read fresh
 * each step because auto-titling can rename the topic mid-run.
 */
export const resolveLobehubSkillVariables = async ({
  agentId,
  ctx,
  state,
  topicId,
}: ServerContextFactInput): Promise<Record<string, string>> => {
  let topicTitle = '';
  if (topicId && ctx.serverDB && ctx.userId) {
    try {
      const topic = await new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId).findById(
        topicId,
      );
      topicTitle = topic?.title ?? '';
    } catch (error) {
      log('Failed to load topic title for lobehub skill placeholders: %O', error);
    }
  }

  return {
    agent_description: state.world?.agent?.description ?? '',
    agent_id: agentId ?? '',
    agent_title: state.world?.agent?.title ?? '',
    topic_id: topicId ?? '',
    topic_title: topicTitle,
  };
};
