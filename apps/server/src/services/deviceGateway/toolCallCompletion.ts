import type { GatewayToolCallCompletion } from '@lobechat/device-gateway-client';
import { agentEnv } from '@lobechat/env/agent';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';

/**
 * Async shell: a device `runCommand` that outlives its wait window parks the
 * run, and the device reports the command's final result when it exits. Off by
 * default — `AGENT_ASYNC_SHELL=true` opts in.
 */
export const isAsyncShellEnabled = (): boolean => agentEnv.AGENT_ASYNC_SHELL === 'true';

/** Server-side wait before a parked command is failed and the run resumed. */
export const ASYNC_SHELL_TIMEOUT_MS = agentEnv.AGENT_ASYNC_SHELL_TIMEOUT_MS ?? 30 * 60 * 1000;

/**
 * How long the agent gateway's inactivity watchdog is told to hold for.
 * Longer than {@link ASYNC_SHELL_TIMEOUT_MS}: the server owns the real timeout
 * (a clean tool error), this only stops the watchdog killing a healthy wait.
 */
export const ASYNC_SHELL_PARK_WINDOW_MS =
  agentEnv.AGENT_ASYNC_SHELL_PARK_WINDOW_MS ?? 2 * 60 * 60 * 1000;

/** The device gateway keeps a registration a little past the server's own deadline. */
const COMPLETION_TTL_SLACK_MS = 10 * 60 * 1000;

export const DEVICE_TOOL_COMPLETION_PATH = '/api/agent/device-tool-completion';

/**
 * The registration that lets the device report this `runCommand`'s final
 * result later, or `undefined` when async shell is off or the call cannot be
 * correlated. The device only watches when this is present, and the server
 * only parks when the device says it is watching (`state.completionWatch`), so
 * an older device or gateway leaves the old polling behaviour in place.
 */
export const buildShellCompletion = (
  toolCallId: string | undefined,
): GatewayToolCallCompletion | undefined => {
  if (!isAsyncShellEnabled() || !toolCallId) return undefined;

  const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  return {
    callbackUrl: urlJoin(baseUrl, DEVICE_TOOL_COMPLETION_PATH),
    toolCallId,
    ttlMs: ASYNC_SHELL_TIMEOUT_MS + COMPLETION_TTL_SLACK_MS,
  };
};
