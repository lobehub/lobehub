import { vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentState } from '../types';

const createCost = () => ({
  calculatedAt: '2026-07-09T00:00:00.000Z',
  currency: 'USD',
  llm: { byModel: [], currency: 'USD', total: 0 },
  tools: { byTool: [], currency: 'USD', total: 0 },
  total: 0,
});

const createUsage = () => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
  tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
});

export const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: createCost(),
  createdAt: '2026-07-09T00:00:00.000Z',
  lastModified: '2026-07-09T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  origin: {
    agentId: 'agent-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: createUsage(),
  ...overrides,
});

export const createToolCall = (id = 'tool-call-1', identifier = 'web-search') => ({
  apiName: 'search',
  arguments: '{"query":"test"}',
  id,
  identifier,
  type: 'default' as const,
});

export const createToolExecutorFixture = () => {
  const toolRows = new Map<string, { id: string; parentId: string }>();
  const createToolMessage = vi.fn().mockImplementation(async (params: any) => {
    if (params?.tool_call_id) {
      toolRows.set(params.tool_call_id, { id: 'tool-msg-1', parentId: params.parentId });
    }
    return { id: 'tool-msg-1' };
  });
  const findToolMessageIdByToolCallId = vi
    .fn()
    .mockImplementation(async (toolCallId: string, parentMessageId: string) => {
      const row = toolRows.get(toolCallId);
      return row && row.parentId === parentMessageId ? row.id : undefined;
    });
  const updateToolIntervention = vi.fn().mockResolvedValue(undefined);
  const updateToolMessage = vi.fn().mockResolvedValue(undefined);
  const publishChunk = vi.fn().mockResolvedValue(undefined);
  const publishError = vi.fn().mockResolvedValue(undefined);
  const publishEvent = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue([{ content: 'refreshed', id: 'msg-1', role: 'user' }]);
  const runTool = vi.fn().mockResolvedValue({
    attempts: 1,
    result: {
      content: 'Tool result',
      executionTime: 100,
      state: {},
      success: true,
    },
  });

  const host = {
    operation: {
      operationId: 'op-1',
      stepIndex: 2,
    },
    transports: {
      messages: {
        createAssistantMessage: vi.fn(),
        createToolMessage,
        deleteMessage: vi.fn(),
        findById: vi.fn(),
        findToolMessageIdByToolCallId,
        getToolMessage: vi.fn(async (id: string) => {
          const entry = [...toolRows].find(([, row]) => row.id === id);
          return entry ? { content: '', id, role: 'tool', tool_call_id: entry[0] } : undefined;
        }),
        query,
        update: vi.fn(),
        updatePluginState: vi.fn(),
        updateToolIntervention,
        updateToolMessage,
      },
      stream: {
        publishChunk,
        publishError,
        publishEvent,
      },
      tools: {
        getCost: vi.fn().mockReturnValue(0),
        handleError: vi.fn(),
        maxRetries: 2,
        run: runTool,
      },
    },
  } as unknown as AgentRuntimeHost;

  return {
    createToolMessage,
    findToolMessageIdByToolCallId,
    updateToolIntervention,
    updateToolMessage,
    toolRows,
    publishChunk,
    publishError,
    publishEvent,
    query,
    runTool,
    host,
  };
};
