import type { LobeChatDatabase } from '@/database/type';

import { publishWebhookEvent } from './emit';

export interface RunWebhookContext {
  agentId?: string | null;
  assistantMessageId?: string | null;
  error?: string | null;
  operationId: string;
  steps: number;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}

/** A run's operation row was written: the run has started. */
export const publishRunStartedWebhook = (
  db: LobeChatDatabase,
  ctx: Pick<RunWebhookContext, 'agentId' | 'operationId' | 'topicId' | 'userId' | 'workspaceId'>,
): void =>
  publishWebhookEvent(db, { userId: ctx.userId, workspaceId: ctx.workspaceId }, 'run.started', {
    agentId: ctx.agentId ?? null,
    runId: ctx.operationId,
    topicId: ctx.topicId ?? null,
  });

const SUCCESS_REASONS = new Set(['done', 'max_steps', 'cost_limit', 'tool_call_repeat_limit']);

/**
 * Map one run-completion reason to its webhook event. Called from the completion
 * lifecycle's Agent Signal outlet, so every terminal reason passes through here once.
 * `interrupted` (cancelled) and async-tool waits have no public event yet.
 */
export const publishRunCompletionWebhook = (
  db: LobeChatDatabase,
  reason: string,
  ctx: RunWebhookContext,
): void => {
  const scope = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const base = {
    agentId: ctx.agentId ?? null,
    runId: ctx.operationId,
    topicId: ctx.topicId ?? null,
  };

  if (reason === 'error') {
    publishWebhookEvent(db, scope, 'run.failed', { ...base, error: ctx.error ?? null });
    return;
  }
  if (reason === 'waiting_for_human') {
    publishWebhookEvent(db, scope, 'run.intervention_requested', base);
    return;
  }
  if (SUCCESS_REASONS.has(reason))
    publishWebhookEvent(db, scope, 'run.completed', {
      ...base,
      assistantMessageId: ctx.assistantMessageId ?? null,
      steps: ctx.steps,
    });
};
