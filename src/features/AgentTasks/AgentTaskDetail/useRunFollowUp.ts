'use client';

import type { ConversationContext, TaskDetailActivity } from '@lobechat/types';
import { useCallback, useState } from 'react';

import { useConversationResourceAccessForTarget } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { useChatStore } from '@/store/chat';
import { useTaskStore } from '@/store/task';

/**
 * The agent a run was executed by. A descendant run reports its own author;
 * otherwise the activity carries the agent that owns the topic.
 */
export const resolveRunAgentId = (activity: TaskDetailActivity): string | undefined =>
  activity.author?.type === 'agent' ? activity.author.id : activity.agentId || undefined;

/**
 * Answering a run means continuing the conversation it ran in: the follow-up
 * becomes a user message in that run's topic, sent over the gateway runtime so
 * it takes the same server-side path as the `runTask` that spawned the topic.
 *
 * A follow-up used to be filed as a task comment instead. A comment is
 * addressed to the *task*, not the run: it renders in the task's activity feed
 * and reaches the agent only when the task runs again, folded into that run's
 * comment digest. The conversation the note was written under never received
 * it, so answering a run produced no reply in that run.
 */
export const useRunFollowUp = (activity: TaskDetailActivity) => {
  const topicId = activity.id;
  const agentId = resolveRunAgentId(activity);

  // Same gate as the drawer's composer: a workspace topic is shared, so a
  // view-only member can watch the run but must not be able to answer in it.
  const { canUseResource } = useConversationResourceAccessForTarget({ agentId });

  const prefetchMessages = useChatStore((s) => s.prefetchMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);

  // The send spans a network round trip; the composer stays busy until it lands.
  const [submitting, setSubmitting] = useState(false);

  const canFollowUp = canUseResource && !!agentId && !!topicId;

  const submitFollowUp = useCallback(
    async (text: string) => {
      if (!canFollowUp || !agentId || !topicId || submitting) return;
      setSubmitting(true);
      try {
        const context: ConversationContext = {
          agentId,
          isolatedTopic: true,
          scope: 'main',
          topicId,
        };
        // Hydrate the topic's history first: sending against an empty message
        // store orphans the reply, with no parent to thread it onto.
        await prefetchMessages(context);
        await sendMessage({ context, forceRuntime: 'gateway', message: text });
        // The message lives in the run's conversation, and that is the only
        // place it can be read or watched — the report it was typed under is a
        // static panel that does not change when the run is answered. Opening
        // the drawer shows it landing and the agent picking it up. A run
        // already in flight in this tab keeps its own connection, so this
        // attaches to it rather than opening a second stream.
        openTopicDrawer(topicId, { agentId, title: activity.title });
      } finally {
        setSubmitting(false);
      }
    },
    [
      activity.title,
      agentId,
      canFollowUp,
      openTopicDrawer,
      prefetchMessages,
      sendMessage,
      submitting,
      topicId,
    ],
  );

  return { canFollowUp, submitFollowUp, submitting };
};
