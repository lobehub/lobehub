import type { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import {
  askThroughBridge,
  attachClaudeCodePermissionResponder,
  isRunningAsRoot,
  PermissionModeReporter,
  resolveClaudeCodePermissionMode,
  setClaudeCodePermissionMode,
} from '@lobechat/heterogeneous-agents/claudeCodePermission';
import type {
  AgentStreamEvent,
  AntigravityLiveInput,
  ClaudeAgentSdkSession,
  ClaudeCodeLiveInput,
} from '@lobechat/heterogeneous-agents/spawn';
import { stopClaudeCodeTask } from '@lobechat/heterogeneous-agents/spawn';
import type { HeteroPermissionMode } from '@lobechat/types';
import { isHeteroPermissionMode } from '@lobechat/types';

/*
 * Claude Code permission modes on this machine (Better Coding Experience lab).
 * The CLI asks over stdio (`--permission-prompt-tool stdio`, see the driver),
 * the SDK through `canUseTool`; both raise their cards on the run's
 * AskUserBridge, so the renderer answers them like any other question card
 * (`submitIntervention`).
 */

/**
 * Answer a live CLI session's permission requests through `bridge` and emit
 * the mode Claude Code reports, in stream order with the run's other events.
 */
export const attachCliPermissionPrompts = ({
  bridge,
  emit,
  live,
  operationId,
  permissionMode,
}: {
  bridge: AskUserBridge;
  emit: (event: AgentStreamEvent) => void;
  live: AntigravityLiveInput | ClaudeCodeLiveInput;
  operationId: string;
  permissionMode: HeteroPermissionMode;
}): void => {
  if (!('sendControlRequest' in live)) return;
  const isRoot = isRunningAsRoot();
  attachClaudeCodePermissionResponder(live, {
    ask: askThroughBridge(bridge),
    cancel: (toolCallId) => bridge.cancel(toolCallId, 'session_ended'),
    isRoot,
  });
  const reporter = new PermissionModeReporter(
    operationId,
    resolveClaudeCodePermissionMode(permissionMode, isRoot).fallback,
  );
  // A mid-run switch: report against the pick (root takes acceptEdits for bypass).
  live.onControlRequestSent((request, meta) => {
    const requestedMode = meta?.requestedMode;
    if (request.subtype === 'set_permission_mode' && isHeteroPermissionMode(requestedMode)) {
      reporter.requested(requestedMode, isRoot);
    }
  });
  live.subscribe((message) => {
    const event = reporter.observe(message);
    if (event) emit(event);
  });
};

/** The parts of a local run a control request reaches: the SDK query, or the CLI stdin. */
interface ControllableSession {
  liveInput?: AntigravityLiveInput | ClaudeCodeLiveInput;
  sdkSession?: ClaudeAgentSdkSession;
}

/**
 * Switch a running session's permission mode (the composer's mode chip).
 * Resolves once Claude Code confirmed, with the mode the session took (it
 * differs from the pick as root); its mode report follows on the stream.
 */
export const setSessionPermissionMode = async (
  session: ControllableSession | undefined,
  mode: HeteroPermissionMode,
): Promise<HeteroPermissionMode> => {
  if (session?.sdkSession) return session.sdkSession.setPermissionMode(mode);
  const live = session?.liveInput;
  if (!live || !('sendControlRequest' in live))
    throw new Error('This run cannot switch its permission mode');
  return setClaudeCodePermissionMode((request) => live.sendControlRequest(request), mode, {
    isRoot: isRunningAsRoot(),
  });
};

/**
 * Stop one background task of a running session. Resolves once Claude Code
 * accepted; its `stopped` report reaches the renderer through the stream.
 */
export const stopSessionBackgroundTask = async (
  session: ControllableSession | undefined,
  taskId: string,
): Promise<void> => {
  if (session?.sdkSession) return session.sdkSession.stopTask(taskId);
  const live = session?.liveInput;
  if (!live || !('sendControlRequest' in live))
    throw new Error('This run cannot stop a single background task');
  await stopClaudeCodeTask((request) => live.sendControlRequest(request), taskId);
};
