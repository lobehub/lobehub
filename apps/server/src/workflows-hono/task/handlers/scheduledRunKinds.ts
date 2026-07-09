import { HETERO_CONTINUE_PROMPT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ExecAgentResult, TopicScheduledRun, TopicScheduledRunKind } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import type { TopicItem } from '@/database/schemas/topic';
import { AiAgentService } from '@/server/services/aiAgent';

export interface ScheduledRunContext {
  db: LobeChatDatabase;
  topic: TopicItem;
  workspaceId?: string;
}

type ScheduledRunHandlers = {
  [K in TopicScheduledRunKind]: (
    run: Extract<TopicScheduledRun, { kind: K }>,
    ctx: ScheduledRunContext,
  ) => Promise<ExecAgentResult>;
};

/**
 * Resume a heterogeneous turn that was parked when the provider rate-limited it.
 *
 * Mirrors `continueHeteroAfterError`: resume the surviving CLI session from the
 * assistant-chain tail with the shared continuation instruction. The failed turn
 * is deliberately NOT deleted before dispatch — a dispatch failure must leave the
 * user's error card and retry entry intact.
 */
const runResumeAfterRateLimit: ScheduledRunHandlers['resume_after_rate_limit'] = async (
  run,
  { db, topic, workspaceId },
) => {
  const messageModel = new MessageModel(db, topic.userId, workspaceId);
  const failedMessage = await messageModel.findById(run.failedAssistantMessageId);
  if (!failedMessage) throw new Error('Scheduled continuation message no longer exists');

  return new AiAgentService(db, topic.userId, { workspaceId }).execAgent({
    agentId: topic.agentId ?? undefined,
    appContext: { topicId: topic.id },
    parentMessageId: failedMessage.id,
    prompt: HETERO_CONTINUE_PROMPT,
    resume: true,
    trigger: RequestTrigger.Cron,
  });
};

/**
 * Fire a run the user deliberately deferred ("send this in 3 hours").
 *
 * The user turn was already persisted at schedule time, so it is the last thing
 * in history and `suppressUserMessage` runs the turn off it rather than injecting
 * a second copy. That also makes the message the single source of truth for the
 * prompt — we read it back here rather than trusting a snapshot in the payload,
 * so a pending run that the user edited fires with the edited text.
 */
const runDelayedStart: ScheduledRunHandlers['delayed_start'] = async (
  run,
  { db, topic, workspaceId },
) => {
  const messageModel = new MessageModel(db, topic.userId, workspaceId);
  const userMessage = await messageModel.findById(run.userMessageId);
  if (!userMessage) throw new Error('Scheduled user message no longer exists');

  return new AiAgentService(db, topic.userId, { workspaceId }).execAgent({
    agentId: topic.agentId ?? undefined,
    appContext: { topicId: topic.id },
    autoStart: true,
    model: run.model,
    // `suppressUserMessage` creates no user row, so the assistant turn anchors on
    // `parentMessageId` alone. Leave it out and the reply persists as a SECOND
    // root: the renderer walks the parentId forest depth-first, so it would land
    // above the very prompt it answers (LOBE-11489).
    parentMessageId: userMessage.id,
    prompt: userMessage.content ?? '',
    provider: run.provider,
    // The user turn is already the tail of history — don't write it twice.
    suppressUserMessage: true,
    trigger: RequestTrigger.Scheduled,
  });
};

const HANDLERS: ScheduledRunHandlers = {
  delayed_start: runDelayedStart,
  resume_after_rate_limit: runResumeAfterRateLimit,
};

/**
 * Run a due {@link TopicScheduledRun}. The dispatcher owns scanning, the claim
 * lease and clearing state — all kind-agnostic; a kind only decides *what*
 * `execAgent` call to make. Adding a kind means adding a variant to
 * {@link TopicScheduledRun} and an entry here; the type forces the pairing.
 */
export const dispatchScheduledRun = (
  run: TopicScheduledRun,
  ctx: ScheduledRunContext,
): Promise<ExecAgentResult> => {
  const handler = HANDLERS[run.kind] as (
    run: TopicScheduledRun,
    ctx: ScheduledRunContext,
  ) => Promise<ExecAgentResult>;

  return handler(run, ctx);
};
