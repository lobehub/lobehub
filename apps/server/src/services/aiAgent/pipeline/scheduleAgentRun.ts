import type { ScheduleAgentRunParams, ScheduleAgentRunResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { type PrecreatedTopicDeps, resolvePrecreatedTopicConfig } from './precreatedTopic';
import { resolveNewTopicSnapshot } from './turnSetup';

const log = debug('lobe-server:ai-agent-service');

export interface ScheduleAgentRunDeps extends PrecreatedTopicDeps {
  messageModel: MessageModel;
  topicModel: TopicModel;
}

/**
 * Defer an agent run to a future time ("send this in 3 hours").
 *
 * Creates the topic now, `scheduled` and empty, carrying the whole request in
 * `metadata.scheduledRun`; the cron dispatcher replays it through `execAgent`
 * once `runAt` passes. The prompt is deliberately NOT pre-persisted as a user
 * message — storing the request whole keeps the dispatch identical to a user
 * pressing send, and keeps editing / cancelling a pending run a single JSONB
 * write.
 *
 * One-shot only: recurring execution belongs to `tasks.automationMode = 'schedule'`.
 */
export const scheduleAgentRun = async (
  deps: ScheduleAgentRunDeps,
  params: ScheduleAgentRunParams,
): Promise<ScheduleAgentRunResult> => {
  const { agentId, slug, prompt, runAt, fileIds, groupId, model, provider } = params;

  if (!agentId && !slug) throw new Error('Either agentId or slug must be provided');

  const runAtDate = new Date(runAt);
  if (Number.isNaN(runAtDate.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid runAt: ${runAt}` });
  }
  if (runAtDate.getTime() <= Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'runAt must be in the future' });
  }

  const agentConfig = await resolvePrecreatedTopicConfig(deps, agentId || slug!, {
    model,
    provider,
  });
  const resolvedAgentId = agentConfig.id;

  const titleSource = markdownToTxt(prompt);
  const snapshot = await resolveNewTopicSnapshot(
    { db: deps.db, userId: deps.userId, workspaceId: deps.workspaceId },
    agentConfig,
    { model, provider },
  );
  const topic = await deps.topicModel.create({
    ...snapshot,
    agentId: resolvedAgentId,
    groupId,
    // A scheduled run is still an ordinary user chat, just deferred — so it
    // keeps the `chat` trigger and stays in the main sidebar (where its
    // `scheduled` status renders a clock), unlike system-owned cron topics.
    title: titleSource.slice(0, 50) + (titleSource.length > 50 ? '...' : ''),
    trigger: 'chat',
  });

  // Persist the user turn now rather than stashing the prompt in metadata: the
  // pending run then reads as the user's own words in the topic, and the message
  // stays the single source of truth for the prompt (the dispatcher reads it
  // back, so editing a pending run is just editing the message).
  const userMessage = await deps.messageModel.create({
    agentId: resolvedAgentId,
    content: prompt,
    files: fileIds,
    groupId: groupId ?? undefined,
    metadata: { trigger: RequestTrigger.Scheduled },
    role: 'user',
    topicId: topic.id,
  });

  const now = new Date().toISOString();
  await deps.topicModel.armScheduledRun(topic.id, {
    createdAt: now,
    kind: 'delayed_start',
    model,
    provider,
    // Normalize to UTC ISO: the dispatcher's due query compares this as text.
    runAt: runAtDate.toISOString(),
    updatedAt: now,
    userMessageId: userMessage.id,
  });

  log(
    'scheduleAgentRun: topic %s scheduled for %s (agent %s, message %s)',
    topic.id,
    runAtDate.toISOString(),
    resolvedAgentId,
    userMessage.id,
  );

  return { agentId: resolvedAgentId, runAt: runAtDate.toISOString(), topicId: topic.id };
};
