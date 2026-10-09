import type { AgentState, ToolRunResult } from '@lobechat/agent-runtime';
import { selectToolSourceMap } from '@lobechat/agent-runtime';
import type { SerializedAgentHook } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import { resolveRunActiveDeviceId } from '@/server/modules/AgentRuntime/executors/resolveRunActiveDeviceId';

import { type HookDispatcher, parseSerializedHooks } from './HookDispatcher';
import {
  blockedToolResult,
  controlToolResult,
  type ToolResultControlOutcome,
} from './toolResultControl';

export interface DeferredToolResultControlInput {
  /** Parent tool whose arguments produced a member anchor's result. */
  contextToolMessageId?: string;
  operationId?: string;
  /** Only server-built child usage, never arbitrary tool/user result fields. */
  preserveUsage?: boolean;
  result: ToolRunResult;
  signal?: AbortSignal;
  toolMessageId: string;
}

/** Reuse the existing private operation hook storage; never project it onto messages. */
export async function loadDurableToolResultHooks(
  operations: Pick<AgentOperationModel, 'findById'>,
  operationId: string,
): Promise<SerializedAgentHook[] | undefined> {
  const operation = await operations.findById(operationId);
  const hooks = operation?.metadata?._hooks;
  return Array.isArray(hooks) ? parseSerializedHooks(hooks) : undefined;
}

/**
 * Deferred completions do not return through ServerToolTransport. Recover their
 * authoritative call and parent hooks before writing the result into history.
 * No notification is added: this only extends explicitly configured controls.
 */
export async function controlDeferredToolResult(
  deps: {
    dispatcher: HookDispatcher;
    loadState: (operationId: string) => Promise<AgentState | null>;
    loadDurableHooks: (operationId: string) => Promise<SerializedAgentHook[] | undefined>;
    messageModel: Pick<MessageModel, 'findById' | 'findMessagePlugin'>;
    userId: string;
    workspaceId?: string;
  },
  input: DeferredToolResultControlInput,
): Promise<ToolResultControlOutcome> {
  const contextMessageId = input.contextToolMessageId ?? input.toolMessageId;
  const [message, persisted, targetMessage] = await Promise.all([
    deps.messageModel.findById(contextMessageId),
    deps.messageModel.findMessagePlugin(input.toolMessageId),
    contextMessageId === input.toolMessageId
      ? undefined
      : deps.messageModel.findById(input.toolMessageId),
  ]);
  const review = message?.metadata?.toolResultControl;
  // A durable denial survives policy removal and late completion replay.
  const targetReview = targetMessage?.metadata?.toolResultControl ?? review;
  if (review?.status === 'blocked' || targetReview?.status === 'blocked') {
    const blocked = blockedToolResult(input.result, input.preserveUsage);
    if (persisted?.state?.onComplete === 'finish') blocked.state!.onComplete = 'finish';
    return {
      blocked: true,
      cancelled: false,
      result: blocked,
      review: { ...(targetReview ?? review)!, status: 'blocked' },
    };
  }
  const operationId = review?.operationId ?? input.operationId;
  const state = operationId ? await deps.loadState(operationId) : null;
  let hooks = state?.host?.hooks;
  if (!state && operationId) {
    hooks = await deps.loadDurableHooks(operationId);
    if (hooks === undefined && review) {
      throw new Error(
        'Cannot recover afterToolCall control policy; retry or restart the pending run',
      );
    }
    // Unmarked rows from pre-feature versions could not register result
    // controls. Preserve that legacy no-hook path; current env controls below
    // are still evaluated. New protected rows cannot lose their marker through
    // ordinary metadata updates or approval rollback.
  }
  if (!deps.dispatcher.hasAfterToolCallControl(operationId ?? '', hooks))
    return {
      blocked: false,
      cancelled: false,
      result: input.result,
      ...(targetReview && { review: { ...targetReview, status: 'allowed' } }),
    };
  const plugin =
    contextMessageId === input.toolMessageId
      ? persisted
      : await deps.messageModel.findMessagePlugin(contextMessageId);
  if (
    !operationId ||
    !message?.parentId ||
    !plugin?.toolCallId ||
    !plugin.identifier ||
    !plugin.apiName
  ) {
    // Do not acknowledge an unreviewed backfill when its authoritative call
    // cannot be reconstructed. A durable callback can retry the same result.
    throw new Error('Cannot evaluate afterToolCall: tool call context is unavailable');
  }
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(plugin.arguments ?? '{}');
    if (isRecord(parsed)) args = parsed;
  } catch {
    // Match the synchronous tool context: malformed arguments have an empty preview.
  }
  const toolName = `${plugin.identifier}/${plugin.apiName}`;
  const controlled = await controlToolResult(
    deps.dispatcher,
    {
      activeDeviceId: state ? resolveRunActiveDeviceId(state) : undefined,
      agentId: state?.origin?.agentId ?? message.agentId ?? undefined,
      apiName: plugin.apiName,
      args,
      assistantMessageId: message.parentId,
      callIndex:
        review?.callIndex ??
        (state?.usage?.tools?.byTool?.find((tool) => tool.name === toolName)?.calls ?? 0) + 1,
      documentId: state?.origin?.documentId,
      executionTarget: state?.plan?.execution?.target,
      executor: 'server',
      groupId: state?.origin?.groupId ?? message.groupId ?? undefined,
      identifier: plugin.identifier,
      mocked: false,
      operationId,
      parentOperationId: state?.origin?.lineage?.parentOperationId,
      result: input.result,
      sessionId: state?.origin?.sessionId ?? message.sessionId ?? undefined,
      sourceMessageId: state?.origin?.sourceMessageId,
      stepIndex: review?.stepIndex ?? Math.max(0, (state?.stepCount ?? 1) - 1),
      taskId: state?.origin?.taskId,
      threadId: state?.origin?.threadId ?? message.threadId ?? undefined,
      toolCallId: plugin.toolCallId,
      toolMessageId: input.toolMessageId,
      toolSource: state ? selectToolSourceMap(state)[plugin.identifier] : undefined,
      topicId: state?.origin?.topicId ?? message.topicId ?? undefined,
      userId: deps.userId,
      workspaceId: state?.origin?.workspaceId ?? deps.workspaceId,
    },
    hooks,
    input.signal,
    input.preserveUsage,
  );
  if (controlled.blocked && plugin.state?.onComplete === 'finish') {
    controlled.result.state!.onComplete = 'finish';
  }
  return controlled;
}
