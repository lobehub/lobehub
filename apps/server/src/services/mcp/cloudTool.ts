import { safeParseJSON } from '@lobechat/utils';

import type { ToolCallContent } from '@/libs/mcp';

import { DiscoverService } from '../discover';
import type { FileService } from '../file';
import { contentBlocksToString, processContentBlocks } from './contentProcessor';

/** Who a cloud MCP call runs as, and where its media is stored. */
export interface CloudMcpCaller {
  discoverService: DiscoverService;
  /**
   * Stores image / audio blocks as files, so the text result links to them.
   * Without it the blocks are formatted as returned (base64 data).
   */
  fileService?: FileService;
  /** The user's Market token, sent when trusted-client auth is not configured. */
  userAccessToken?: string;
}

/** The agent runtime's caller: the user's trusted-client identity only. */
export const runtimeCloudMcpCaller = (userId?: string | null): CloudMcpCaller => ({
  discoverService: new DiscoverService({ userInfo: userId ? { userId } : undefined }),
});

/**
 * Run a tool of a marketplace MCP the market hosts (a "cloud" endpoint)
 * through the market's cloud gateway, by identifier. Shared by the agent
 * runtime's MCP executor and connector tool calls.
 */
export const callCloudMcpTool = async (
  params: { args?: string; identifier: string; toolName: string },
  caller: CloudMcpCaller,
) => {
  // Returns CloudGatewayResponse: { content: ToolCallContent[], isError?: boolean }
  const cloudResult = await caller.discoverService.callCloudMcpEndpoint({
    apiParams: safeParseJSON(params.args) || {},
    identifier: params.identifier,
    toolName: params.toolName,
    userAccessToken: caller.userAccessToken,
  });
  const rawContent = (cloudResult?.content ?? []) as ToolCallContent[];
  const content =
    cloudResult?.isError || !caller.fileService
      ? rawContent
      : await processContentBlocks(rawContent, caller.fileService);

  return {
    content: contentBlocksToString(content),
    state: { ...cloudResult, content },
    success: !cloudResult?.isError,
  };
};
