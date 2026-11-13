import { McpEventsIdentifier } from '@lobechat/builtin-tool-mcp-events';
import { McpEventsExecutionRuntime } from '@lobechat/builtin-tool-mcp-events/executionRuntime';

import { McpEventsService } from '@/server/services/inboundWebhook/kinds/mcpEvents/service';

import type { ServerRuntimeRegistration } from './types';

export const mcpEventsRuntime: ServerRuntimeRegistration = {
  identifier: McpEventsIdentifier,
  factory: (context) => {
    if (!context.serverDB || !context.userId || !context.agentId || !context.topicId) {
      throw new Error('MCP Events requires an authenticated agent and topic');
    }
    return new McpEventsExecutionRuntime(
      new McpEventsService(context.serverDB, context.userId, context.workspaceId),
      { agentId: context.agentId, topicId: context.topicId },
    );
  },
};
