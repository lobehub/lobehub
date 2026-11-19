import { BRANDING_NAME } from '@lobechat/business-const';
import type { DeviceToolCallResult } from '@lobechat/device-gateway-client';

/** Code of a tunneled MCP call answered by a device client too old to run MCP calls. */
export const MCP_DEVICE_CLIENT_OUTDATED = 'MCP_DEVICE_CLIENT_OUTDATED';

/** Code of any other failed tunneled MCP call. */
export const MCP_DEVICE_EXECUTION_ERROR = 'MCP_DEVICE_EXECUTION_ERROR';

/**
 * What an `lh connect` from before MCP support (CLI 0.0.78 and older) answers a
 * tunneled MCP call with: it ignores the call's `mcp` type, looks the MCP tool's
 * name up among its own built-in device tools, and finds none.
 */
const legacyUnknownToolReply = (apiName: string) => `Unknown tool API: ${apiName}`;

export const mcpDeviceClientOutdatedMessage = (identifier: string, apiName: string) =>
  `MCP tool '${apiName}' of '${identifier}' did not run: the device that received the call runs an \`lh connect\` too old for MCP servers, which looked for a built-in device tool named '${apiName}' instead of calling the MCP server. Update the LobeHub CLI on that computer (\`lh update\`, then restart \`lh connect\`) or open the ${BRANDING_NAME} desktop app there, and try again.`;

/**
 * A device's reply to a tunneled MCP call, with the reply of an `lh connect` too
 * old to run MCP calls turned into an error that says so. Left as it is, the
 * caller reads `Unknown tool API: <tool>` for a tool the connector lists, which
 * looks like a tool list out of step with the server rather than an outdated
 * client.
 */
export const classifyMcpCallReply = (
  call: { apiName: string; identifier: string },
  result: DeviceToolCallResult,
): DeviceToolCallResult => {
  if (result.success) return result;
  const reply = (result.error || result.content || '').trim();
  if (reply !== legacyUnknownToolReply(call.apiName)) return result;
  return {
    content: mcpDeviceClientOutdatedMessage(call.identifier, call.apiName),
    error: MCP_DEVICE_CLIENT_OUTDATED,
    success: false,
  };
};

/** The structured error of a failed tunneled MCP call that carries no `errorData`. */
export const mcpDeviceCallError = (result: DeviceToolCallResult) =>
  result.error === MCP_DEVICE_CLIENT_OUTDATED
    ? { code: MCP_DEVICE_CLIENT_OUTDATED, message: result.content }
    : { code: MCP_DEVICE_EXECUTION_ERROR, message: result.error || result.content };
