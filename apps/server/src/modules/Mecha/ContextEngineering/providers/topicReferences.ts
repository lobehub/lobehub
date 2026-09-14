import { resolveTopicReferences, type TopicReferenceItem } from '@lobechat/context-engine';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { buildPostProcessUrl } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

/**
 * Summaries for the topics a `<refer_topic>` tag points at. Skipped when the
 * messages already carry an injected `topic_reference_context` (client-side
 * preprocessing) to avoid double injection.
 */
export const resolveTopicReferenceFacts = async ({
  ctx,
  messagesForContext,
}: ServerContextFactInput): Promise<TopicReferenceItem[] | undefined> => {
  const alreadyHasTopicRefs = (messagesForContext as Array<{ content: string | unknown }>).some(
    (message) =>
      typeof message.content === 'string' && message.content.includes('topic_reference_context'),
  );
  if (alreadyHasTopicRefs || !ctx.serverDB || !ctx.userId) return undefined;

  const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
  const messageModel = new MessageModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
  const agentShareVisitor = ctx.agentShareVisitor;
  // Topic references are limited to the visitor's own topics in shared runs.
  // `TopicModel`'s built-in ownership scoping is not sufficient here — the
  // rows are owned by the CREATOR, so every one of the creator's private
  // topics would otherwise be addressable by a `<refer_topic>` tag the
  // visitor typed. Match the visitor/agent pairing of the active share
  // instead: a visitor topic is tied to its share purely through
  // `(agentId, senderId)`, since `agent_shares` is 1:1 per agent.
  //
  // Known gap: a topic created before the owner paused the share still
  // matches `(agentId, senderId)` for a returning visitor, because topics
  // carry no share-instance column. Such a topic is the SAME visitor's own
  // prior conversation with the SAME agent, so this leaks nothing across
  // identities — it only means old context can resurface once the share is
  // turned back on.
  const isTopicVisibleToRun = (
    topic: { agentId?: string | null; senderId?: string | null } | null | undefined,
  ): boolean => {
    if (!agentShareVisitor) return true;
    return (
      topic?.senderId === agentShareVisitor.visitorUserId &&
      topic?.agentId === agentShareVisitor.agentId
    );
  };

  return resolveTopicReferences(
    messagesForContext as Array<{ content: string | unknown }>,
    async (topicId) => {
      const topic = await topicModel.findById(topicId);
      return isTopicVisibleToRun(topic) ? topic : null;
    },
    async (topicId) => {
      const topic = await topicModel.findById(topicId);
      if (!isTopicVisibleToRun(topic)) return [];

      return messageModel.query(
        {
          agentId: topic?.agentId ?? undefined,
          groupId: topic?.groupId ?? undefined,
          topicId,
        },
        // `isTopicVisibleToRun` above already proved this referenced topic is
        // the SAME visitor's own conversation with the SAME agent, so the
        // creator-facing agent-share exclusion must not apply here.
        { allowShareVisitor: true, postProcessUrl: buildPostProcessUrl(ctx) },
      );
    },
  );
};
