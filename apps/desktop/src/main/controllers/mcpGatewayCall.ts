import type { GatewayMcpParams } from '@lobechat/device-gateway-client';

import type McpCtr from './McpCtr';

/** Preserve invocation identity across the device transport and native MCP host. */
export async function executeMcpGatewayCall(
  mcpCtr: McpCtr,
  mcpCall: { apiName: string; arguments: string; identifier: string; params: GatewayMcpParams },
) {
  const { apiName, arguments: args, params } = mcpCall;

  if (params.type === 'http') {
    return mcpCtr.runHttpMcpTool(
      { auth: params.auth, headers: params.headers, name: params.name, url: params.url },
      apiName,
      args,
      params.elicitation,
    );
  }

  return mcpCtr.runStdioMcpTool({
    elicitation: params.elicitation,
    args,
    env: params.env,
    params: {
      args: params.args,
      command: params.command,
      name: params.name,
    },
    toolName: apiName,
  });
}
