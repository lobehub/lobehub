import { McpEventsIdentifier } from '@lobechat/builtin-tool-mcp-events';
import { McpEventsExecutionRuntime } from '@lobechat/builtin-tool-mcp-events/executionRuntime';

import { McpEventsService } from '@/server/services/inboundWebhook/kinds/mcpEvents/service';
import { InboundWebhookManager } from '@/server/services/inboundWebhook/manage';

import type { ServerRuntimeRegistration } from './types';

/**
 * The agent's MCP Events tools, acting as the signed-in user: subscribing works in the run's
 * topic; listing the whole agent, renaming, checking and removing go through the same manager as
 * Settings and the `lh` CLI. No `workspaceRole` is passed, so the agent never gets a workspace
 * admin's reach. A share visitor's run never gets here (the tool is not share-allowed); refuse it
 * regardless.
 */
export const mcpEventsRuntime: ServerRuntimeRegistration = {
  identifier: McpEventsIdentifier,
  factory: (context) => {
    const { agentId, agentShareVisitor, operationId, serverDB: db, topicId, userId } = context;
    if (!db || !userId || !agentId || !topicId || agentShareVisitor) {
      throw new Error('MCP Events requires an authenticated agent and topic');
    }
    return new McpEventsExecutionRuntime(
      {
        events: new McpEventsService(db, userId, context.workspaceId),
        manager: new InboundWebhookManager(db, { userId, workspaceId: context.workspaceId }),
      },
      { agentId, operationId, topicId, userId },
    );
  },
};
