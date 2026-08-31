import type { AgentRuntimeHost } from '@lobechat/agent-runtime';
import { callTool, callToolsBatch } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CliMessageTransport } from './CliMessageTransport';
import type { MessageSyncOperation } from './messageSync';
import { MessageWriteQueue } from './MessageWriteQueue';

/**
 * Drives the REAL agent-runtime tool executors against the local transport, so
 * the store is checked against the contract the runtime actually imposes rather
 * than against my reading of it. In particular the runtime re-queries the whole
 * message list after every tool step — that read has to be answered locally and
 * has to return what the executor expects, or a device-hosted run silently
 * rebuilds the wrong state.
 */
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

const createState = (overrides?: Record<string, unknown>) =>
  ({
    cost: createCost(),
    createdAt: '2026-07-09T00:00:00.000Z',
    lastModified: '2026-07-09T00:00:00.000Z',
    maxSteps: 100,
    messages: [],
    metadata: { agentId: 'agent-1', topicId: 'topic-1' },
    operationId: 'op-1',
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    usage: createUsage(),
    ...overrides,
  }) as never;

const createToolCall = (id = 'tool-call-1') => ({
  apiName: 'search',
  arguments: '{"query":"test"}',
  id,
  identifier: 'web-search',
  type: 'default' as const,
});

describe('CliMessageTransport driving the real runtime executors', () => {
  let transport: CliMessageTransport;
  let queue: MessageWriteQueue;
  let flushed: MessageSyncOperation[][];
  let host: AgentRuntimeHost;

  beforeEach(() => {
    flushed = [];
    queue = new MessageWriteQueue({
      sink: {
        flush: async (operations) => {
          flushed.push(operations);
        },
      },
    });
    transport = new CliMessageTransport({ queue });

    host = {
      operation: { operationId: 'op-1', stepIndex: 2 },
      transports: {
        messages: transport,
        stream: {
          publishChunk: vi.fn().mockResolvedValue(undefined),
          publishError: vi.fn().mockResolvedValue(undefined),
          publishEvent: vi.fn().mockResolvedValue(undefined),
        },
        tools: {
          getCost: vi.fn().mockReturnValue(0),
          handleError: vi.fn(),
          maxRetries: 2,
          run: vi.fn().mockResolvedValue({
            attempts: 1,
            result: { content: 'Tool result', executionTime: 100, state: {}, success: true },
            // Without this the executor keeps the row in memory instead of
            // re-reading the store — which would leave the very path this
            // suite exists to cover untested.
            resultPersisted: true,
          }),
        },
      },
    } as unknown as AgentRuntimeHost;
  });

  it('persists a tool result and rebuilds state from the local store', async () => {
    const assistant = await transport.createAssistantMessage({
      // Deliberately NO agentId: the runtime re-queries with the state's
      // `agentId`, but a concrete topic is the conversation boundary, so this
      // row must still come back — the same rule that keeps delegated-agent
      // (`callAgent`) replies in context.
      content: 'calling a tool',
      role: 'assistant',
      topicId: 'topic-1',
    });

    const result = await callTool(host)(
      {
        payload: { parentMessageId: assistant.id, toolCalling: createToolCall() },
        type: 'call_tool',
      } as never,
      createState(),
    );

    // `newState.messages` is the runtime's re-query through this transport —
    // it must come back with the tool row that was just written.
    const rebuilt = result.newState.messages;
    expect(rebuilt).toContainEqual(
      expect.objectContaining({ content: 'Tool result', role: 'tool' }),
    );
    expect(rebuilt).toContainEqual(expect.objectContaining({ id: assistant.id }));
    expect(result.nextContext?.phase).toBe('tool_result');
  });

  it('answers the runtime read-back without waiting on the sink', async () => {
    // A sink that never settles stands in for an unreachable network.
    const stalled = new MessageWriteQueue({ sink: { flush: () => new Promise<void>(() => {}) } });
    const offline = new CliMessageTransport({ queue: stalled });
    const offlineHost = {
      ...host,
      transports: { ...host.transports, messages: offline },
    } as AgentRuntimeHost;

    const assistant = await offline.createAssistantMessage({
      agentId: 'agent-1',
      content: 'calling a tool',
      role: 'assistant',
      topicId: 'topic-1',
    });

    // Would hang if any step awaited replication.
    const result = await callTool(offlineHost)(
      {
        payload: { parentMessageId: assistant.id, toolCalling: createToolCall() },
        type: 'call_tool',
      } as never,
      createState(),
    );

    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ content: 'Tool result', role: 'tool' }),
    );
  });

  it('keeps one row per tool call across a batch and queues each for replication', async () => {
    const assistant = await transport.createAssistantMessage({
      agentId: 'agent-1',
      content: 'calling three tools',
      role: 'assistant',
      topicId: 'topic-1',
    });

    const result = await callToolsBatch(host)(
      {
        payload: {
          parentMessageId: assistant.id,
          toolsCalling: [createToolCall('c1'), createToolCall('c2'), createToolCall('c3')],
        },
        type: 'call_tools_batch',
      } as never,
      createState(),
    );

    const toolRows = result.newState.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolRows).toHaveLength(3);
    // Distinct rows, not one row overwritten three times.
    expect(new Set(toolRows.map((m: { id: string }) => m.id)).size).toBe(3);

    await queue.drain();
    const operations = flushed.flat();
    // One assistant + three tool rows.
    expect(operations.filter((o) => o.type === 'createMessage')).toHaveLength(4);
    // Every replicated create carries the id assigned locally, so a replay
    // rewrites the same row instead of inserting a duplicate.
    for (const op of operations) {
      if (op.type === 'createMessage') expect(op.message.id).toBeTruthy();
    }
  });
});
