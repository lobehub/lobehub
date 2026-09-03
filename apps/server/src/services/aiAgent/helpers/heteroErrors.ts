import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { getHeterogeneousAgentConfig } from '@lobechat/heterogeneous-agents';
import { ChatErrorType, type ErrorType } from '@lobechat/types';

/**
 * Turn a raw device-gateway dispatch error code into a human-readable headline.
 * The gateway returns terse machine codes (e.g. `GATEWAY_NOT_CONFIGURED`) which,
 * surfaced verbatim, render as a cryptic error card. We rewrite the headline the
 * caller keeps for non-web surfaces (IM bots) while retaining the raw code in
 * `detail` for diagnostics. Web clients localize via the mapped error type below.
 */
const HETERO_DISPATCH_ERROR_HEADLINES: Record<string, string> = {
  GATEWAY_NOT_CONFIGURED:
    "The run device gateway isn't configured on the server, so this agent can't reach a device to run on. Configure the device gateway, or switch this agent to a connected local device.",
};

export const humanizeHeteroDispatchError = (raw?: string): string =>
  (raw && HETERO_DISPATCH_ERROR_HEADLINES[raw]) || raw || 'Device dispatch failed';

/**
 * Map a raw dispatch code to a dedicated `ChatErrorType` so the web client renders
 * its own localized headline (the generic `ServerAgentRuntimeError` copy would
 * otherwise mask the specific message). Unknown codes keep the generic type.
 */
const HETERO_DISPATCH_ERROR_TYPES: Record<string, ErrorType> = {
  GATEWAY_NOT_CONFIGURED: ChatErrorType.DeviceGatewayNotConfigured,
};

export const resolveHeteroDispatchErrorType = (raw?: string): ErrorType =>
  (raw && HETERO_DISPATCH_ERROR_TYPES[raw]) || ChatErrorType.ServerAgentRuntimeError;

export const supportsCloudHeterogeneousSandbox = (type: HeterogeneousAgentType): boolean =>
  type === 'claude-code' || type === 'codex';

export const getHeterogeneousAgentTitle = (type: HeterogeneousAgentType): string =>
  getHeterogeneousAgentConfig(type)?.title ?? type;
