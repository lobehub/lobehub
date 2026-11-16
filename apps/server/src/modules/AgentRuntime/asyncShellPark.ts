import type { AgentState, ToolRunExecution } from '@lobechat/agent-runtime';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import {
  ASYNC_SHELL_PARK_WINDOW_MS,
  ASYNC_SHELL_TIMEOUT_MS,
} from '@/server/services/deviceGateway/toolCallCompletion';

import type { RuntimeExecutorContext } from './context';

const log = debug('lobe-server:agent-runtime:async-shell');

/**
 * A device shell command may outlive the tool call that started it. Rather
 * than holding the step (800s function ceiling) or handing the model a
 * `shell_id` to poll, the runtime parks the operation; the device reports the
 * command's final result through the device gateway when it exits
 * (`/api/agent/device-tool-completion`), and that resumes the run.
 */

interface CommandStateShape {
  commandId?: unknown;
  completionWatch?: unknown;
  error?: unknown;
  exitCode?: unknown;
  isBackground?: unknown;
  running?: unknown;
  success?: unknown;
}

/**
 * Whether this dispatch handed off a command that is still running AND that the
 * device promised to report on.
 *
 * `run_in_background` returns before observing (no `running` flag), and a
 * foreground call that outlived its wait window reports `running: true`. A
 * command that failed to spawn is not a wait: it already has an answer.
 * `completionWatch` is the device's promise that a late result will follow —
 * without it (older device or gateway) nothing would ever resume the run, so
 * the model keeps the `shell_id` and polls as before.
 */
const runningShellId = (state: unknown): string | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const shell = state as CommandStateShape;
  if (shell.completionWatch !== true) return undefined;
  if (typeof shell.commandId !== 'string' || shell.commandId.length === 0) return undefined;
  if (shell.error) return undefined;
  if (shell.exitCode !== undefined && shell.exitCode !== null) return undefined;
  if (shell.success === false) return undefined;
  if (shell.isBackground === true || shell.running === true) return shell.commandId;
  return undefined;
};

/**
 * How the step would have size-limited this call's result. The late result
 * arrives with no step context, so the park records it for the completion.
 */
export interface AsyncShellResultLimit {
  /** Whether the run can page an archived result (`lobe-agent-documents`). */
  canReadArchive: boolean;
  /** The run's `toolResultMaxLength`; unset → the default limit. */
  maxLength?: number;
}

export interface ParkAsyncShellParams {
  /**
   * The tool row this call already owns — set when the call resumes after an
   * approval. The completion is written into it instead of a second row with
   * the same `tool_call_id`.
   */
  existingToolMessageId?: string;
  /** Which message owns this tool call — the placeholder hangs off it. */
  parentMessageId: string;
  resultLimit?: AsyncShellResultLimit;
  state: AgentState;
  toolCall: ChatToolPayload;
}

/**
 * Park the operation on a still-running shell command.
 *
 * Returns the deferred execution for the runtime, or `null` when this call is
 * not a long-running shell and should be handled normally.
 */
export const parkAsyncShell = async (
  ctx: RuntimeExecutorContext,
  { existingToolMessageId, parentMessageId, resultLimit, state, toolCall }: ParkAsyncShellParams,
  /** Only the device's command state is read. */
  result: { state?: unknown },
): Promise<ToolRunExecution | null> => {
  if (toolCall.identifier !== LocalSystemIdentifier) return null;
  if (toolCall.apiName !== 'runCommand') return null;

  const commandId = runningShellId(result.state);
  if (!commandId) return null;

  const agentId = state.origin?.agentId;
  const topicId = ctx.topicId ?? state.origin?.topicId;
  if (!agentId || !topicId) {
    // Without an anchor the placeholder cannot be created, so the barrier could
    // never clear. Fall through to the normal result instead of parking.
    log('park skipped: missing agent/topic (op=%s)', ctx.operationId);
    return null;
  }

  const startedAt = new Date().toISOString();
  const pluginState = {
    asyncShell: {
      // Everything the completion needs to size-limit the result the way this
      // step would have (see `archiveRuntimeToolResult` in the transport).
      archive: {
        agentId,
        canReadArchive: resultLimit?.canReadArchive ?? false,
        maxLength: resultLimit?.maxLength,
        topicId,
        workspaceId: state.origin?.workspaceId ?? ctx.workspaceId,
      },
      commandId,
      startedAt,
      timeoutMs: ASYNC_SHELL_TIMEOUT_MS,
    },
    status: 'pending',
  };

  // The row the completion will be written into. Created here — before the
  // park — because the runtime's pause chunk has to advertise it (otherwise the
  // client never loads the row) and the completion barrier looks it up by
  // `tool_call_id`.
  let placeholderId: string;
  if (existingToolMessageId) {
    await ctx.messageModel.updatePluginState(existingToolMessageId, pluginState);
    placeholderId = existingToolMessageId;
  } else {
    const placeholder = await ctx.messageModel.create({
      agentId,
      content: '',
      groupId: state.origin?.groupId ?? undefined,
      parentId: parentMessageId,
      plugin: toolCall as any,
      pluginState,
      role: 'tool',
      threadId: state.origin?.threadId,
      tool_call_id: toolCall.id,
      topicId,
    });
    placeholderId = placeholder.id;
  }

  // Ask the gateway to stop treating this run's silence as a dead function
  // until the command comes back. Best-effort: an older gateway answers 404 and
  // the caller's own timeout still bounds the wait.
  // `stepIndex` scopes the park to this step: the step's own closing events
  // still follow, and must not end the park the way the resume does.
  await ctx.streamManager.markOperationParked?.(ctx.operationId, {
    parkedUntil: Date.now() + ASYNC_SHELL_PARK_WINDOW_MS,
    reason: 'async_shell',
    stepIndex: ctx.stepIndex,
  });

  // One deadline, not a poll: if the device never reports back the run would
  // otherwise sit parked until the gateway's own (longer) watchdog kills it with
  // an opaque inactivity error. This writes a real tool error instead, so the
  // model can adapt.
  await ctx.scheduleShellExpiry?.({
    delayMs: ASYNC_SHELL_TIMEOUT_MS,
    operationId: ctx.operationId,
    toolCallId: toolCall.id,
    toolMessageId: placeholderId,
  });

  log(
    'parked op=%s on shell %s (toolCallId=%s, messageId=%s)',
    ctx.operationId,
    commandId,
    toolCall.id,
    placeholderId,
  );

  return {
    attempts: 1,
    result: {
      content: '',
      deferred: true,
      // `deferredToolMessageId` lifts this onto the pause chunk so the client
      // pulls the placeholder into its store while the run is parked.
      state: {
        commandId,
        isBackground: true,
        startedAt,
        success: true,
        toolMessageId: placeholderId,
      },
      success: true,
    },
  };
};
