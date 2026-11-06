import { safeParseJSON } from '@lobechat/utils';

import type { ToolCallContent } from '@/libs/mcp';

import { DiscoverService } from '../discover';
import { contentBlocksToString } from './contentProcessor';

/**
 * Run a tool of a marketplace MCP the market hosts (a "cloud" endpoint)
 * through the market's cloud gateway, by identifier. Shared by the agent
 * runtime's MCP executor and connector tool calls.
 */
export const callCloudMcpTool = async (params: {
  args?: string;
  identifier: string;
  toolName: string;
  userId?: string | null;
}) => {
  const discoverService = new DiscoverService({
    userInfo: params.userId ? { userId: params.userId } : undefined,
  });

  // Returns CloudGatewayResponse: { content: ToolCallContent[], isError?: boolean }
  const cloudResult = await discoverService.callCloudMcpEndpoint({
    apiParams: safeParseJSON(params.args) || {},
    identifier: params.identifier,
    toolName: params.toolName,
  });
  const content = (cloudResult?.content ?? []) as ToolCallContent[];

  return {
    content: contentBlocksToString(content),
    state: { ...cloudResult, content },
    success: !cloudResult?.isError,
  };
};
