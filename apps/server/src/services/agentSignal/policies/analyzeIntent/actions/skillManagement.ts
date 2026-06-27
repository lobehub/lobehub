import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import type { LobeChatDatabase } from '@/database/type';
import type { AgentSignalOperationMarker } from '@/server/services/agentSignal/operationMarker';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import { enqueueSelfIterationRun } from '../../../services/selfIteration/dispatch/enqueueSelfIterationRun';
import type { ProcedureStateService } from '../../../services/types';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type { ActionSkillManagementHandle } from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';

export interface SkillManagementActionHandlerOptions {
  db: LobeChatDatabase;
  /**
   * Test seam: dispatch the async skill-management run. Defaults to the shared
   * `enqueueSelfIterationRun` (execAgent queue under the skill-management slug).
   */
  dispatch?: typeof enqueueSelfIterationRun;
  /** Optional procedure state (unused by the async path; kept for wiring parity). */
  procedureState?: Pick<ProcedureStateService, 'skillIntentRecords'>;
  /** User-visible response language; reserved for prompt localisation. */
  responseLanguage?: string;
  selfIterationEnabled: boolean;
  userId: string;
  /** Workspace id when the run belongs to a team workspace; scopes the skill write. */
  workspaceId?: string;
}

const finalizeAttempt = (
  startedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt | AgenticAttempt => ({
  completedAt: Date.now(),
  current: 1,
  startedAt,
  status,
});

const toExecutorError = (actionId: string, error: unknown, startedAt: number): ExecutorResult => ({
  actionId,
  attempt: finalizeAttempt(startedAt, 'failed'),
  error: {
    cause: error,
    code: 'SKILL_MANAGEMENT_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  },
  status: 'failed',
});

const toSkippedResult = (actionId: string, detail: string, startedAt: number): ExecutorResult => ({
  actionId,
  attempt: finalizeAttempt(startedAt, 'skipped'),
  detail,
  status: 'skipped',
});

const isSkillManagementAction = (action: BaseAction): action is ActionSkillManagementHandle =>
  action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle;

/**
 * Renders the same-turn skill feedback into the agent prompt. The builtin
 * skill-management agent's systemRole carries the behavioural instructions; this
 * only embeds the evidence (feedback message + routing reason + turn context).
 */
const buildSkillFeedbackPrompt = (input: {
  agentId: string;
  evidence?: ActionSkillManagementHandle['payload']['evidence'];
  message: string;
  reason?: string;
  serializedContext?: string;
  sourceId: string;
  userId: string;
}): string =>
  [
    `Agent id: ${input.agentId}`,
    `User id: ${input.userId}`,
    `Source id: ${input.sourceId}`,
    'User feedback (already routed to the skill domain — a reusable procedure to capture as a managed skill):',
    input.message,
    input.reason ? `Routing reason: ${input.reason}` : undefined,
    input.serializedContext ? `Turn context: ${input.serializedContext}` : undefined,
    input.evidence?.length ? `Evidence: ${JSON.stringify(input.evidence)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Executes one skill-management action by enqueueing an async `execAgent` run
 * under the builtin `skill-management` slug. The run inspects existing managed
 * skills and applies one safe skill create/refine; its durable skill receipt is
 * projected on the `agent.execution.completed` completion path from finalState.
 *
 * Returns immediately with an `applied` (enqueued) status — no synchronous
 * decision/apply, no blocking executeSync, no Vercel timeout risk. Mirrors the
 * memory-writer async path (`handleUserMemoryAction`).
 */
export const executeSkillManagementAction = async (
  action: BaseAction,
  options: SkillManagementActionHandlerOptions,
  context: RuntimeProcessorContext,
): Promise<ExecutorResult> => {
  const startedAt = Date.now();
  const idempotencyKey =
    'idempotencyKey' in action.payload && typeof action.payload.idempotencyKey === 'string'
      ? action.payload.idempotencyKey
      : undefined;

  try {
    if (await hasAppliedActionIdempotency(context, idempotencyKey)) {
      return toSkippedResult(
        action.actionId,
        'Skill-management action already applied.',
        startedAt,
      );
    }

    if (!isSkillManagementAction(action)) {
      return toSkippedResult(
        action.actionId,
        'Unsupported skill-management action type.',
        startedAt,
      );
    }

    if (!options.selfIterationEnabled) {
      return toSkippedResult(action.actionId, 'Self iteration is disabled.', startedAt);
    }

    const message = action.payload.message?.trim();
    if (!message) {
      return toSkippedResult(
        action.actionId,
        'Missing skill-management action message.',
        startedAt,
      );
    }

    const agentId = action.payload.agentId;
    if (!agentId) {
      return toSkippedResult(
        action.actionId,
        'Missing agentId for skill-management action.',
        startedAt,
      );
    }

    const sourceId = idempotencyKey ?? action.actionId;
    const { assistantMessageId, messageId, topicId } = action.payload;

    // Anchor the skill seed under the completed assistant turn when the synthesis
    // ran deferred at `agent.execution.completed` (LOBE-10802); fall back to the
    // user message for the legacy inbound dispatch. Anchoring to the assistant
    // message keeps the seed inside the assistant group instead of surfacing as a
    // floating `parent_id=null` mainline root.
    const anchorMessageId = assistantMessageId ?? messageId;

    const prompt = buildSkillFeedbackPrompt({
      agentId,
      evidence: action.payload.evidence,
      message,
      reason: action.payload.reason,
      serializedContext: action.payload.serializedContext,
      sourceId,
      userId: options.userId,
    });

    // The run executes under the builtin skill-management slug, so attribute the
    // receipt to the reviewed user agent via `marker.agentId` (the operation's
    // own agentId is the builtin agent).
    const marker: AgentSignalOperationMarker = {
      agentId,
      kind: 'skill',
      sourceId,
      ...(anchorMessageId ? { anchorMessageId } : {}),
      ...(messageId ? { triggerMessageId: messageId } : {}),
      ...(topicId ? { topicId } : {}),
    };

    const dispatch = options.dispatch ?? enqueueSelfIterationRun;
    await dispatch({
      agentId,
      db: options.db,
      marker,
      prompt,
      slug: BUILTIN_AGENT_SLUGS.skillManagement,
      ...(anchorMessageId ? { sourceMessageId: anchorMessageId } : {}),
      threadTitle: 'Agent Signal Skill',
      ...(topicId ? { topicId } : {}),
      userId: options.userId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    });

    await markAppliedActionIdempotency(context, idempotencyKey);

    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'succeeded'),
      detail: 'Skill write enqueued.',
      status: 'applied',
    };
  } catch (error) {
    return toExecutorError(action.actionId, error, startedAt);
  }
};

/**
 * Creates the action handler that enqueues async skill writes for skill-domain
 * feedback.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackActionPlannerSignalHandler}
 *   -> `action.skill-management.handle`
 *     -> {@link defineSkillManagementActionHandler}
 *       -> {@link executeSkillManagementAction}
 */
export const defineSkillManagementActionHandler = (
  options: SkillManagementActionHandlerOptions,
) => {
  return defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
    'handler.skill-management.handle',
    async (action, context: RuntimeProcessorContext) => {
      return executeSkillManagementAction(action, options, context);
    },
  );
};
