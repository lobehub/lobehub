/**
 * Completion push recall for runs the user is waiting on.
 */
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { notifyAgentRunCompleted } from '@/business/server/agent-run/notifyAgentRunCompleted';

import type { CompletionLifecycleDeps } from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * Triggers whose completion recalls the user with a push notification. Beyond
 * plain chat: `Scheduled` is a user-deferred chat turn ("send this in 3
 * hours"), and `Cron` is today stamped only by the rate-limit auto-resume of a
 * user's own chat turn (see scheduledRunKinds) — both are exactly the "user
 * walked away mid-conversation" case the recall exists for. Everything else
 * (task runner, bots, evals, API, agent-signal self-iterations, …) is
 * background work and stays silent.
 */
const USER_RECALLABLE_TRIGGERS = new Set<string>([
  RequestTrigger.Chat,
  RequestTrigger.Cron,
  RequestTrigger.Scheduled,
]);

/**
 * The facts the recall gate needs. The trigger rides on `state.origin` for
 * in-process runs (the appContext spread); synthetic terminals
 * ({@link buildStateFromInput}) have none, so fall back to the op row
 * `recordStart` stamped — which also reveals `parentOperationId`, marking
 * internal child runs (verifier/repair/evidence pass it without `isSubAgent`).
 * `trigger: undefined` means neither source knows.
 */
export async function resolveRunRecallFacts(
  deps: CompletionLifecycleDeps,
  operationId: string,
  runOrigin: { trigger?: unknown } | undefined,
): Promise<{ isChildRun: boolean; trigger: string | undefined }> {
  if (typeof runOrigin?.trigger === 'string')
    return { isChildRun: false, trigger: runOrigin.trigger };

  try {
    const operation = await deps.agentOperationModel.findById(operationId);
    return {
      isChildRun: Boolean(operation?.parentOperationId),
      trigger: operation?.trigger ?? undefined,
    };
  } catch (error) {
    log('[%s] Failed to resolve run trigger from op row: %O', operationId, error);
    return { isChildRun: false, trigger: undefined };
  }
}

/**
 * Push a completion recall — but only for runs the user is waiting on.
 * Background executions (scheduled tasks, bots, evals, …) complete constantly
 * and would spam the OS banner. An unknown trigger passes: human-approval
 * chat continuations can reach here without one, and dropping a chat push is
 * worse than a rare stray banner.
 */
export async function recallUserOnCompletion(
  deps: CompletionLifecycleDeps,
  operationId: string,
  event: { agentId?: string; duration?: number; lastAssistantContent?: string; topicId?: string },
  runOrigin: { trigger?: unknown; userId?: string } | undefined,
): Promise<void> {
  const { isChildRun, trigger } = await resolveRunRecallFacts(deps, operationId, runOrigin);
  if (isChildRun) {
    log('[%s] Skipping completion push for internal child run', operationId);
    return;
  }
  if (trigger !== undefined && !USER_RECALLABLE_TRIGGERS.has(trigger)) {
    log('[%s] Skipping completion push for non-interactive trigger %s', operationId, trigger);
    return;
  }

  await notifyAgentRunCompleted({
    agentId: event.agentId || undefined,
    duration: event.duration,
    lastAssistantContent: event.lastAssistantContent,
    operationId,
    topicId: event.topicId,
    userId: runOrigin?.userId || deps.userId,
    // Personal runs leave this undefined ⇒ bare deep link; workspace
    // runs carry the id so the business slot can slug-prefix the URL.
    workspaceId: deps.workspaceId,
  });
}
