import { describe, expect, it, vi } from 'vitest';

import type McpCtr from './McpCtr';
import { executeMcpGatewayCall } from './mcpGatewayCall';

describe('MCP device gateway invocation identity', () => {
  it.each(['http', 'stdio'] as const)(
    'preserves the owner/operation/call and deadline for %s',
    async (type) => {
      const elicitation = {
        identity: {
          apiName: 'form',
          assistantMessageId: 'a',
          identifier: 'fixture',
          operationId: 'op',
          toolCallId: 'one',
        },
        deadline: 123,
        workspaceId: 'w',
      };
      const runHttpMcpTool = vi.fn().mockResolvedValue({ success: true });
      const runStdioMcpTool = vi.fn().mockResolvedValue({ success: true });
      const controller = { runHttpMcpTool, runStdioMcpTool } as unknown as McpCtr;
      await executeMcpGatewayCall(controller, {
        apiName: 'form',
        arguments: '{}',
        identifier: 'fixture',
        params:
          type === 'http'
            ? { type, name: 'fixture', url: 'https://example.com/mcp', elicitation }
            : { type, name: 'fixture', command: 'node', args: [], elicitation },
      });
      if (type === 'http') expect(runHttpMcpTool.mock.calls[0][3]).toBe(elicitation);
      else expect(runStdioMcpTool.mock.calls[0][0].elicitation).toBe(elicitation);
    },
  );
});
