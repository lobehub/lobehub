import { extractTodosFromMessages, normalizeTodosState } from '@lobechat/agent-runtime';
import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import type { PlanTodoConfig } from '@lobechat/context-engine';

import { TopicDocumentModel } from '@/database/models/topicDocument';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

/**
 * The current TODO state. Message history is the source of truth; the plan
 * document is only a best-effort mirror consulted when history carries no
 * TODO state yet and the run has `lobe-agent`.
 */
export const resolvePlanTodoFacts = async ({
  ctx,
  enabledToolIds,
  messagesForContext,
  topicId,
  workspaceId,
}: ServerContextFactInput): Promise<PlanTodoConfig | undefined> => {
  const messageTodos = extractTodosFromMessages(messagesForContext);
  if (messageTodos !== undefined) return { enabled: true, todos: messageTodos };

  if (!enabledToolIds.includes('lobe-agent') || !topicId || !ctx.serverDB || !ctx.userId) {
    return undefined;
  }
  try {
    const [planDocument] = await new TopicDocumentModel(
      ctx.serverDB,
      ctx.userId,
      workspaceId,
    ).findByTopicId(topicId, { type: AGENT_PLAN_FILE_TYPE });
    if (!planDocument) return undefined;
    const todos = normalizeTodosState(
      planDocument.metadata?.todos,
      planDocument.updatedAt.toISOString(),
    );
    return todos === undefined ? undefined : { enabled: true, todos };
  } catch (error) {
    log('Failed to resolve plan TODO context for topic %s: %O', topicId, error);
    return undefined;
  }
};
