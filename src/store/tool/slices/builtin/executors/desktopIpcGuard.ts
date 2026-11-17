import {
  type DesktopIpcUnavailableReason,
  getDesktopIpcUnavailableReason,
  trackDesktopIpcUnavailable,
} from '@/utils/electron/ipc';

import type { BuiltinToolResult, IBuiltinToolExecutor } from '../types';

export const DESKTOP_TOOL_UNAVAILABLE_ERROR_TYPE = 'DesktopRuntimeUnavailable';

const buildRecovery = (reason: DesktopIpcUnavailableReason, toolLabel: string): string =>
  reason === 'not-desktop'
    ? `this conversation is running in a web browser, which cannot reach the user's computer. Do not retry ${toolLabel} calls in this run; tell the user to continue this conversation in the LobeHub desktop app, then retry.`
    : `LobeHub Desktop lost its connection to the local system in this window (window.electronAPI.invoke is missing). Do not retry ${toolLabel} calls until it is restored; tell the user to reload the window (Cmd/Ctrl+R) to reconnect it, or restart LobeHub Desktop if reloading does not help, then retry.`;

export const buildDesktopToolUnavailableResult = (
  reason: DesktopIpcUnavailableReason,
  toolLabel: string,
): BuiltinToolResult => {
  const message = `${toolLabel} is unavailable: ${buildRecovery(reason, toolLabel)}`;

  return {
    content: message,
    error: { body: { reason }, message, type: DESKTOP_TOOL_UNAVAILABLE_ERROR_TYPE },
    success: false,
  };
};

/**
 * Guards an executor whose every API goes through Electron IPC (local files,
 * shell, Computer Use).
 *
 * Its calls normally run inside the desktop app, but a web client can still be
 * handed one: a paused call from a desktop client-runtime run approved in the
 * browser, or a model in a browser run repeating a call it sees in the topic's
 * history. Without the bridge every call used to fail with a developer-facing
 * "Ensure the preload exposes invoke" error, which the model read as a broken
 * desktop install and kept retrying. Answer instead with a result that says
 * where the call can run and what the user has to do, and record it.
 *
 * Only `invoke` is guarded: the before/after hooks also fire for calls that ran
 * elsewhere (server or device), so they keep their own behavior.
 */
export const withDesktopIpcGuard = <T extends IBuiltinToolExecutor>(
  executor: T,
  toolLabel: string,
): IBuiltinToolExecutor => ({
  getApiNames: executor.getApiNames.bind(executor),
  hasApi: executor.hasApi.bind(executor),
  identifier: executor.identifier,
  invoke: async (apiName, params, ctx) => {
    const reason = getDesktopIpcUnavailableReason();
    if (!reason) return executor.invoke(apiName, params, ctx);

    trackDesktopIpcUnavailable(reason, {
      api_name: apiName,
      identifier: executor.identifier,
      source: 'tool',
    });
    return buildDesktopToolUnavailableResult(reason, toolLabel);
  },
  onAfterCall: executor.onAfterCall?.bind(executor),
  onBeforeCall: executor.onBeforeCall?.bind(executor),
});
