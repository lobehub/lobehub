// @vitest-environment node
import {
  type AgentRuntimeHost,
  type AgentState,
  createAgentRuntimeExecutors,
} from '@lobechat/agent-runtime';
import { UnauthorizedError } from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { agentOperations, agents, topics, users } from '@/database/schemas';
import { ServerMessageTransport } from '@/server/modules/AgentRuntime/adapters/ServerMessageTransport';
import { ServerToolTransport } from '@/server/modules/AgentRuntime/adapters/ServerToolTransport';
import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';
import { MCPService } from '@/server/services/mcp';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';
import { ToolExecutionService } from '@/server/services/toolExecution';

import { MessageCollector } from '../../../../../../packages/conversation-flow/src/transformation/MessageCollector';
import { getTestDB } from '../../../../../../packages/database/src/core/getTestDB';

vi.mock('@/server/services/file/impls', () => ({ createFileServiceModule: () => ({}) }));
const db = await getTestDB();
const userId = 'mcp-message-reuse-test';
const messages = new MessageModel(db, userId);
const tool = {
  id: 'call_1',
  identifier: 'fixture',
  apiName: 'noop',
  type: 'mcp' as const,
  arguments: '{}',
};
const identity = {
  apiName: tool.apiName,
  identifier: tool.identifier,
  assistantMessageId: 'reuse-assistant',
  operationId: 'reuse-op',
  toolCallId: tool.id,
};

beforeEach(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'reuse-agent', userId });
  await db.insert(topics).values({ id: 'reuse-topic', userId, agentId: 'reuse-agent' });
  await db.insert(agentOperations).values({
    id: identity.operationId,
    userId,
    agentId: 'reuse-agent',
    topicId: 'reuse-topic',
    status: 'running',
  });
  await messages.create(
    {
      role: 'assistant',
      content: '',
      agentId: 'reuse-agent',
      topicId: 'reuse-topic',
      tools: [tool],
      metadata: { operationId: identity.operationId },
    },
    identity.assistantMessageId,
  );
});
afterAll(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

afterEach(() => vi.restoreAllMocks());

// Crosses the real shared executor, server transports, MCP execution service and
// PostgreSQL message model. Only the remote MCP call is replaced at its I/O boundary.
describe('MCP message ownership without elicitation', () => {
  it.each(['success', 'tool-error', 'network-error', 'authorization', 'missing-gateway'] as const)(
    'fills the precreated row for %s and rehydrates its actual result',
    async (outcome) => {
      const mcp = new MCPService();
      const call = vi.spyOn(mcp, 'callTool').mockImplementation(async () => {
        if (outcome === 'network-error') throw new Error('remote connection lost');
        if (outcome === 'authorization') throw new UnauthorizedError();
        return { content: 'remote-receipt', success: outcome !== 'tool-error', state: {} };
      });
      const service = new ToolExecutionService({
        builtinToolsExecutor: {} as never,
        mcpService: mcp,
      });
      const manifest = {
        identifier: 'fixture',
        type: 'mcp' as const,
        api: [{ name: 'noop', parameters: { type: 'object' as const, properties: {} } }],
        mcpParams:
          outcome === 'missing-gateway'
            ? { type: 'stdio', command: 'fixture' }
            : { type: 'http', url: 'https://mcp.example.com' },
      };
      const state = {
        operationId: identity.operationId,
        status: 'running',
        messages: [],
        origin: { agentId: 'reuse-agent', topicId: 'reuse-topic' },
        toolManifestMap: { fixture: manifest },
        usage: { tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 } },
        cost: {
          tools: { byTool: [], currency: 'USD', total: 0 },
          llm: { byModel: [], total: 0 },
          total: 0,
        },
      } as unknown as AgentState;
      const host: AgentRuntimeHost = {
        operation: { operationId: identity.operationId, stepIndex: 1, agentId: 'reuse-agent' },
        transports: {
          messages: new ServerMessageTransport(messages),
          stream: { publishEvent: vi.fn(), publishChunk: vi.fn() },
          tools: new ServerToolTransport({
            operationId: identity.operationId,
            stepIndex: 1,
            userId,
            serverDB: db,
            messageModel: messages,
            streamManager: {},
            toolExecutionService: service,
            isInterrupted: async () => false,
          } as unknown as RuntimeExecutorContext),
        },
      };
      // Let the execution service create the row during dispatch, after the
      // shared executor's initial replay lookup has already found no result.
      const ensured = vi.spyOn(McpElicitationService.prototype, 'ensureToolMessage');
      await createAgentRuntimeExecutors(host).call_tool(
        {
          type: 'call_tool',
          payload: { parentMessageId: identity.assistantMessageId, toolCalling: tool },
        },
        state,
      );
      const originalId = await ensured.mock.results[0].value;
      const rows = await messages.query({ topicId: 'reuse-topic' });
      const children = rows.filter(
        (row) => row.parentId === identity.assistantMessageId && row.role === 'tool',
      );
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(originalId);
      expect(children[0].content).not.toBe('');
      expect(children[0].content).toContain(
        outcome === 'success' || outcome === 'tool-error'
          ? 'remote-receipt'
          : outcome === 'missing-gateway'
            ? 'gateway'
            : outcome === 'authorization'
              ? 'authorization'
              : 'remote connection lost',
      );
      const assistant = rows.find((row) => row.id === identity.assistantMessageId)!;
      const collector = new MessageCollector(
        new Map(rows.map((row) => [row.id, row])),
        new Map([[identity.assistantMessageId, children.map((row) => row.id)]]),
      );
      expect(collector.collectToolMessages(assistant, rows)).toEqual(children);
      expect(call).toHaveBeenCalledTimes(outcome === 'missing-gateway' ? 0 : 1);
      call.mockRestore();
    },
  );
});
