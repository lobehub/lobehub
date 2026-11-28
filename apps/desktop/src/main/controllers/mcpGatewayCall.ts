import type { GatewayMcpParams } from '@lobechat/device-gateway-client';

import type McpCtr from './McpCtr';

/**
 * Preserve invocation identity across the device transport and native MCP host,
 * and run the call the way the server asked (`params.mcpCall`): a view's call
 * keeps its media inline and reaches only app-visible tools.
 */
export async function executeMcpGatewayCall(
  mcpCtr: McpCtr,
  mcpCall: { apiName: string; arguments: string; identifier: string; params: GatewayMcpParams },
) {
  const { apiName, arguments: args, params } = mcpCall;
  const { fromApp, fromEntrypoint, mcpApps } = params.mcpCall ?? {};
  const options = {
    ...(fromApp && { fromApp }),
    ...(fromEntrypoint && { fromEntrypoint }),
    ...(mcpApps && { mcpApps }),
  };

  if (params.type === 'http') {
    return mcpCtr.runHttpMcpTool(
      { auth: params.auth, headers: params.headers, name: params.name, url: params.url },
      apiName,
      args,
      params.elicitation,
      options,
    );
  }

  return mcpCtr.runStdioMcpTool({
    ...options,
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
