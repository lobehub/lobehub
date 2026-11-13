import type { AgentState, ToolRunExecution } from '@lobechat/agent-runtime';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { agentEnv } from '@lobechat/env/agent';
import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import type { ToolExecutionResultResponse } from '@/server/services/toolExecution';

import type { RuntimeExecutorContext } from './context';

const log = debug('lobe-server:agent-runtime:async-shell');

/**
 * A shell command may outlive the tool call that started it. Rather than
 * holding the step (800s function ceiling) or handing the model a `shell_id` to
 * poll, the runtime parks the operation and lets the device report completion
 * as a late `tool_result` — which the agent-runtime resume path turns into the
 * tool's real answer.
 *
 * Off by default: `AGENT_ASYNC_SHELL=true` opts in, because it changes what the
 * model sees and depends on the gateway understanding a parked operation.
 */
export const isAsyncShellEnabled = (): boolean => agentEnv.AGENT_ASYNC_SHELL === 'true';

/** Default server-side wait before the parked command is failed. */
export const DEFAULT_ASYNC_SHELL_TIMEOUT_MS =
  agentEnv.AGENT_ASYNC_SHELL_TIMEOUT_MS ?? 30 * 60 * 1000;

/**
 * How long the gateway's inactivity watchdog is told to hold for. Deliberately
 * longer than {@link DEFAULT_ASYNC_SHELL_TIMEOUT_MS}: the server owns the real
 * timeout (and reports it as a clean tool error), while this only has to stop
 * the watchdog from killing a healthy wait.
 */
export const ASYNC_SHELL_PARK_WINDOW_MS =
  agentEnv.AGENT_ASYNC_SHELL_PARK_WINDOW_MS ?? 2 * 60 * 60 * 1000;

interface CommandStateShape {
  commandId?: unknown;
  error?: unknown;
  exitCode?: unknown;
  isBackground?: unknown;
  running?: unknown;
  success?: unknown;
}

/**
 * Whether this dispatch handed off a command that is still running.
 *
 * `run_in_background` returns before observing (no `running` flag), and a
 * foreground call that outlived its wait window reports `running: true`. A
 * command that failed to spawn is not a wait: it already has an answer.
 */
const runningShellId = (state: unknown): string | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const shell = state as CommandStateShape;
  if (typeof shell.commandId !== 'string' || shell.commandId.length === 0) return undefined;
  if (shell.error) return undefined;
  if (shell.exitCode !== undefined && shell.exitCode !== null) return undefined;
  if (shell.success === false) return undefined;
  if (shell.isBackground === true || shell.running === true) return shell.commandId;
  return undefined;
};

export interface ParkAsyncShellParams {
  /** Which message owns this tool call — the placeholder hangs off it. */
  parentMessageId: string;
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
  { parentMessageId, state, toolCall }: ParkAsyncShellParams,
  result: ToolExecutionResultResponse,
): Promise<ToolRunExecution | null> => {
  if (!isAsyncShellEnabled()) return null;
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
      commandId,
      startedAt,
      timeoutMs: DEFAULT_ASYNC_SHELL_TIMEOUT_MS,
    },
    status: 'pending',
  };

  // The row the completion will be written into. Created here — before the
  // park — because the runtime's pause chunk has to advertise it (otherwise the
  // client never loads the row) and the completion barrier looks it up by
  // `tool_call_id`.
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

  // Ask the gateway to stop treating this run's silence as a dead function
  // until the command comes back. Best-effort: an older gateway answers 404 and
  // the caller's own timeout still bounds the wait.
  await ctx.streamManager.markOperationParked?.(ctx.operationId, {
    parkedUntil: Date.now() + ASYNC_SHELL_PARK_WINDOW_MS,
    reason: 'async_shell',
  });

  // One deadline, not a poll: if the device never reports back the run would
  // otherwise sit parked until the gateway's own (longer) watchdog kills it with
  // an opaque inactivity error. This writes a real tool error instead, so the
  // model can adapt.
  await ctx.scheduleShellExpiry?.({
    delayMs: DEFAULT_ASYNC_SHELL_TIMEOUT_MS,
    operationId: ctx.operationId,
    toolCallId: toolCall.id,
    toolMessageId: placeholder.id,
  });

  log(
    'parked op=%s on shell %s (toolCallId=%s, messageId=%s)',
    ctx.operationId,
    commandId,
    toolCall.id,
    placeholder.id,
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
        toolMessageId: placeholder.id,
      },
      success: true,
    },
  };
};
