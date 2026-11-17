import type { CallSubAgentParams } from '@lobechat/builtin-tool-lobe-agent';
import {
  buildBackgroundSubAgentReceipt,
  buildSteeredSubAgentReceipt,
  withLegacyCallAgentNote,
} from '@lobechat/builtin-tool-lobe-agent';
import type { LobeChatDatabase } from '@lobechat/database';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { ThreadModel } from '@/database/models/thread';

import type { ToolExecutionContext } from '../types';
import { startBackgroundSubAgent } from './backgroundSubAgent';

/** Where the dispatching run sits; the caller's own agent is never a target. */
export interface CallSubAgentScope {
  /** The dispatching agent. */
  agentId?: string | null;
  db: LobeChatDatabase;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export interface CallSubAgentOptions {
  /**
   * The call came in through the retired `lobe-agent-management.callAgent`
   * alias: every result it returns also asks the model to move to
   * `callSubAgent`. The deferred answer gets the same note from the completion
   * bridge, which recognizes the alias by the tool call itself.
   */
  legacyCallAgent?: boolean;
}

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

/** Strict-schema models fill every declared field: blank means "not set". */
const readOptionalId = (value: unknown): string | undefined | { invalid: true } => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return { invalid: true };
  return value.trim() || undefined;
};

/**
 * The agent a continued sub-agent runs as. A sub-agent keeps the agent it was
 * started with, so `subAgentId` alone is enough to continue another agent; an
 * `agentId` that names a different agent is refused rather than silently
 * switching it. An unknown thread is left to the run, which reports it.
 */
const resolveContinuedTarget = async (
  scope: CallSubAgentScope,
  subAgentId: string,
  requestedAgentId: string | undefined,
): Promise<{ error: string } | { targetAgentId?: string }> => {
  const thread = await new ThreadModel(scope.db, scope.userId, scope.workspaceId).findById(
    subAgentId,
  );
  const threadAgentId = thread?.agentId ?? undefined;
  const target = threadAgentId && threadAgentId !== scope.agentId ? threadAgentId : undefined;

  if (thread && requestedAgentId && requestedAgentId !== target) {
    return {
      error: `Sub-agent "${subAgentId}" ${target ? `runs as agent "${target}"` : 'is a copy of you'}, not "${requestedAgentId}". Leave agentId empty to continue it, or omit subAgentId to start a new sub-agent with that agent.`,
    };
  }

  return { targetAgentId: target ?? (thread ? undefined : requestedAgentId) };
};

/**
 * `lobe-agent.callSubAgent` on the server, shared with the `callAgent` alias.
 *
 * Forks a child as an independent async operation. Returns a `deferred`
 * result instead of a tool_result: the agent runtime parks the parent op
 * (`waiting_for_async_tool`) until the child finishes, at which point the
 * completion bridge backfills the placeholder tool message and resumes the
 * parent. The placeholder + child-op kickoff are handled by the injected
 * `ctx.subAgent` runner (which owns the parent message anchor).
 *
 * Without `agentId` the child is an anonymous copy of the caller; with it the
 * child is that agent — any agent the user can access, including external
 * (heterogeneous) agents — running on its own configuration.
 */
export const runCallSubAgent = async (
  params: CallSubAgentParams,
  ctx: ToolExecutionContext,
  scope: CallSubAgentScope,
  options: CallSubAgentOptions = {},
): Promise<BuiltinServerRuntimeOutput> => {
  const note = (output: BuiltinServerRuntimeOutput): BuiltinServerRuntimeOutput =>
    options.legacyCallAgent && !output.deferred
      ? { ...output, content: withLegacyCallAgentNote(output.content) }
      : output;
  const fail = (content: string, code: string) => note(buildError(content, code));

  if (ctx.isSubAgent) {
    return fail(
      'Sub-agent calls cannot be triggered from within another sub-agent.',
      'NESTED_SUB_AGENT_NOT_ALLOWED',
    );
  }

  if (!ctx.subAgent) {
    return fail('Sub-agent execution is not available in this runtime.', 'SUB_AGENT_UNAVAILABLE');
  }

  const { instruction, timeout } = params;
  if (!instruction || typeof instruction !== 'string') {
    return fail('instruction is required.', 'INVALID_ARGUMENTS');
  }

  const subAgentIdInput = readOptionalId(params.subAgentId);
  if (typeof subAgentIdInput === 'object') {
    return fail('subAgentId must be a string.', 'INVALID_ARGUMENTS');
  }
  const agentIdInput = readOptionalId(params.agentId);
  if (typeof agentIdInput === 'object') {
    return fail('agentId must be a string.', 'INVALID_ARGUMENTS');
  }
  const subAgentId = subAgentIdInput;
  // Naming yourself means a copy of yourself.
  const requestedAgentId = agentIdInput === scope.agentId ? undefined : agentIdInput;

  let targetAgentId = requestedAgentId;
  if (subAgentId) {
    const continued = await resolveContinuedTarget(scope, subAgentId, requestedAgentId);
    if ('error' in continued) return fail(continued.error, 'INVALID_ARGUMENTS');
    targetAgentId = continued.targetAgentId;
  }

  // The target must be an agent this user can reach in this workspace — the
  // same scoped read the run itself resolves the agent with.
  let targetTitle: string | undefined;
  let targetIsExternal = false;
  if (targetAgentId) {
    const target = await new AgentModel(
      scope.db,
      scope.userId,
      scope.workspaceId,
    ).getAgentConfigById(targetAgentId);
    if (!target) {
      return fail(
        `Agent "${targetAgentId}" was not found or you do not have access to it. Use an agent id from <available_agents>, <mentioned_agents> or searchAgent; a marketplace agent has to be added to the workspace first.`,
        'AGENT_NOT_FOUND',
      );
    }
    targetTitle = target.title || undefined;
    targetIsExternal = !!target.agencyConfig?.heterogeneousProvider;
  }

  const description =
    (typeof params.description === 'string' && params.description.trim()) ||
    targetTitle ||
    (targetAgentId ? `Call agent ${targetAgentId}` : 'Sub-agent');
  const background = params.runInBackground === true;

  const runner = ctx.subAgent;
  const startRun = () =>
    runner.run({
      background,
      description,
      instruction,
      subAgentId,
      timeout,
      ...(targetAgentId && {
        agentId: targetAgentId,
        // A named agent answers as itself; a copy answers with the call's label.
        senderName: targetTitle ?? targetAgentId,
      }),
      ...(targetIsExternal && { canSteer: false }),
    });

  let runResult: Awaited<ReturnType<typeof startRun>>;
  if (background) {
    const outcome = await startBackgroundSubAgent({
      continuesThreadId: subAgentId,
      db: scope.db,
      groupId: scope.groupId,
      retryHint: 'Call callSubAgent again without runInBackground to wait for the result.',
      start: startRun,
      threadId: scope.threadId,
      topicId: scope.topicId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    if ('refusal' in outcome) return fail(outcome.refusal.message, outcome.refusal.code);
    runResult = outcome.result;
  } else {
    runResult = await startRun();
  }
  const { started, error, steered, threadId, subOperationId, toolMessageId } = runResult;

  // The child op failed to start — no completion bridge will ever fire to
  // backfill a placeholder, so we must NOT defer/park here. Return a normal
  // (non-deferred) tool error so the parent's LLM sees the failure and the
  // batch continues instead of hanging in `waiting_for_async_tool`.
  if (!started) {
    const subject = targetAgentId ? `Agent "${targetTitle ?? targetAgentId}"` : 'Sub-agent';
    const action = subAgentId ? 'could not be continued' : 'failed to start';
    return fail(
      error ? `${subject} ${action}: ${error}` : `${subject} ${action}.`,
      'SUB_AGENT_START_FAILED',
    );
  }

  // Steered a sub-agent that is still running: the instruction joins its next
  // step, and the running call reports the answer. Nothing to wait for here.
  if (steered) {
    return note({
      content: buildSteeredSubAgentReceipt(threadId),
      state: { status: 'completed', steered: true, threadId },
      success: true,
      toolMessageId,
    });
  }

  // Detached: the receipt is the whole tool result and the parent keeps going.
  // It goes into the placeholder the runner created (it anchors the thread);
  // the answer reaches the parent later as its own message.
  if (background) {
    return note({
      content: buildBackgroundSubAgentReceipt(threadId),
      success: true,
      toolMessageId,
    });
  }

  return {
    // No tool_result yet — the bridge fills this in when the sub-op completes.
    content: '',
    deferred: true,
    // `toolMessageId` rides along so the runtime's pause chunk can tell the
    // client which row to fetch; the client never sees it as tool state.
    state: {
      status: 'pending',
      subOperationId,
      ...(targetAgentId && { targetAgentId }),
      threadId,
      toolMessageId,
    },
    success: true,
  };
};
