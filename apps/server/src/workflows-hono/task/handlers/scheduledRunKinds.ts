import { HETERO_CONTINUE_PROMPT, LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ExecAgentResult, TopicScheduledRun, TopicScheduledRunKind } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { TopicItem } from '@/database/schemas/topic';
import { AiAgentService } from '@/server/services/aiAgent';

export interface ScheduledRunContext {
  /** The dispatcher's claim lease id — fences post-dispatch writes against stale attempts. */
  claimId: string;
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
 * Mirrors `continueHeteroAfterError` — including its ordering: the stale
 * rate-limit card is cleared BEFORE dispatch. A step that preserved work
 * (streamed content / tool calls) keeps its body and only drops the error; an
 * error-only step would render as an empty block, so it is deleted and the
 * continuation anchors on its parent instead. Then the surviving CLI session is
 * resumed from that anchor with the shared continuation instruction.
 *
 * If dispatch fails (e.g. device offline) the topic stays `scheduled` and the
 * next tick retries; by then the failed message may already be cleaned or gone,
 * so a missing message is not an error — the retry falls back to anchoring on
 * the user turn recorded in the payload.
 */
const runResumeAfterRateLimit: ScheduledRunHandlers['resume_after_rate_limit'] = async (
  run,
  { claimId, db, topic, workspaceId },
) => {
  const messageModel = new MessageModel(db, topic.userId, workspaceId);
  const failedMessage = await messageModel.findById(run.failedAssistantMessageId);

  let parentMessageId = run.userMessageId;
  if (failedMessage) {
    const hasSalvageableWork =
      (Array.isArray(failedMessage.tools) && failedMessage.tools.length > 0) ||
      (!!failedMessage.content && failedMessage.content !== LOADING_FLAT);

    if (hasSalvageableWork) {
      await messageModel.update(failedMessage.id, { error: null });
      parentMessageId = failedMessage.id;
    } else {
      await messageModel.deleteMessage(failedMessage.id);
      parentMessageId = failedMessage.parentId ?? run.userMessageId;
    }
  }

  const result = await new AiAgentService(db, topic.userId, { workspaceId }).execAgent({
    agentId: topic.agentId ?? undefined,
    appContext: { topicId: topic.id },
    parentMessageId,
    prompt: HETERO_CONTINUE_PROMPT,
    resume: true,
    trigger: RequestTrigger.Cron,
  });

  // A dispatch that fails inside execAgent (device offline, access denied, …)
  // leaves its own error bubble on the placeholder it created
  // (`finalizeHeteroDispatchError`) — the user still sees why the continuation
  // didn't fire. Track that bubble as the run's failed message so the next
  // tick's pre-dispatch cleanup clears it exactly like the original card;
  // otherwise every failed attempt would strand one more stale error card.
  // Fenced on our claim lease: an attempt that outlived it (or whose schedule
  // was cancelled and re-armed) must not re-point a newer run.
  if (!result.success && result.assistantMessageId) {
    await TopicModel.repointScheduledRunFailedMessage(
      db,
      topic.id,
      result.assistantMessageId,
      claimId,
    );
  }

  return result;
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
