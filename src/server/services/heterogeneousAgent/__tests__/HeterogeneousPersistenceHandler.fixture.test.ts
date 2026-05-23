// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

/**
 * Synthetic fixture mirroring the shape of a real CC run captured under
 * `.heerogeneous-tracing/cc-streaming.json` (gitignored, not available in
 * CI). Rather than read a real trace, we generate a stream that exercises
 * the same characteristics:
 *
 *   - Multiple text chunks bursting within the same millisecond (verifies
 *     the data-fingerprint dedupe key, not just timestamps)
 *   - 30 tool_use → tool_result pairs across multiple steps
 *   - Step boundaries (`stream_start { newStep: true }`) cutting new
 *     assistants chained off the last tool message
 *   - Per-turn metadata events (`step_complete` phase=turn_metadata) with
 *     usage payloads
 *   - Terminal `agent_runtime_end`
 *
 * If the real trace shape changes (new event variants, new chunk types),
 * regenerate the fixture below to match. The aim is "deterministic stand-in
 * for the broad real-trace flow", not "byte-equal capture".
 */

const TOOLS_PER_STEP = 10;
const STEP_COUNT = 3;
const TEXT_CHUNKS_PER_STEP = 5;

interface FakeMessage {
  agentId: string | null;
  content: string;
  error?: any;
  id: string;
  metadata?: any;
  model?: string;
  parentId?: string | null;
  plugin?: any;
  pluginError?: any;
  pluginState?: any;
  provider?: string;
  reasoning?: any;
  role: 'user' | 'assistant' | 'tool' | 'task' | 'system';
  threadId?: string | null;
  tool_call_id?: string;
  tools?: any[];
  topicId: string | null;
}

const buildSyntheticStream = (): AgentStreamEvent[] => {
  const events: AgentStreamEvent[] = [];
  // Use a single anchor timestamp shared across many bursty chunks to verify
  // that the dedupe key fingerprints `data` (not just timestamp+stepIndex).
  const burstyTimestamp = 1_700_000_000_000;
  let sequence = 0;
  let stepIndex = 0;

  const push = (
    type: AgentStreamEvent['type'],
    data: Record<string, unknown>,
    overrides: { stepIndex?: number; timestamp?: number } = {},
  ) => {
    sequence += 1;
    events.push({
      data,
      operationId: 'op-fixture',
      stepIndex: overrides.stepIndex ?? stepIndex,
      // Default each event to a unique timestamp; bursty chunks override.
      timestamp: overrides.timestamp ?? burstyTimestamp + sequence,
      type,
    });
  };

  for (let step = 0; step < STEP_COUNT; step += 1) {
    if (step > 0) {
      // Cut a new step — the renderer parity test asserts the new assistant
      // chains off the last tool of the previous step.
      push('stream_start', { newStep: true });
    }

    // Burst N text chunks all sharing the same timestamp. With the old
    // (stepIndex, type, timestamp) key, all but the first would dedupe. The
    // fingerprinted key keeps each chunk distinct via its `content`.
    for (let t = 0; t < TEXT_CHUNKS_PER_STEP; t += 1) {
      push(
        'stream_chunk',
        { chunkType: 'text', content: `step-${step}-chunk-${t} ` },
        { timestamp: burstyTimestamp + step * 1000 },
      );
    }

    // Tool calls in this step.
    const stepTools = Array.from({ length: TOOLS_PER_STEP }, (_, i) => ({
      apiName: 'Bash',
      arguments: JSON.stringify({ cmd: `cmd-${step}-${i}` }),
      id: `tc-${step}-${i}`,
      identifier: 'bash',
      type: 'default' as const,
    }));

    push('stream_chunk', {
      chunkType: 'tools_calling',
      toolsCalling: stepTools,
    });

    // Tool results — one per tool, with content varying by id.
    for (const tool of stepTools) {
      push('tool_result', {
        content: `result of ${tool.id}`,
        toolCallId: tool.id,
      });
    }

    // Per-turn usage.
    push('step_complete', {
      model: 'claude-opus-4-7',
      phase: 'turn_metadata',
      provider: 'claude-code',
      usage: { inputTokens: 100 + step, outputTokens: 50 + step },
    });

    stepIndex += 1;
  }

  push('agent_runtime_end', { reason: 'success' });
  return events;
};

const createHarness = () => {
  let nextSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, any>();

  messages.set('asst-fixture', {
    agentId: null,
    content: '',
    id: 'asst-fixture',
    role: 'assistant',
    topicId: 'topic-fixture',
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextSeq += 1;
      const msgId = id ?? `msg_${nextSeq}`;
      const msg: FakeMessage = {
        agentId: input.agentId ?? null,
        content: input.content ?? '',
        id: msgId,
        metadata: input.metadata,
        model: input.model,
        parentId: input.parentId ?? null,
        plugin: input.plugin,
        provider: input.provider,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        topicId: input.topicId ?? null,
      };
      messages.set(msgId, msg);
      return msg;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, { ...existing, ...patch });
      return { success: true };
    }),
    updateToolMessage: vi.fn(async (id: string, patch: any) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, {
        ...existing,
        content: patch.content ?? existing.content,
        pluginError: patch.pluginError,
        pluginState: patch.pluginState ?? existing.pluginState,
      });
      return { success: true };
    }),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    listMessagePluginsByTopic: vi.fn(async (_topicId: string) => []),
  };

  const threadModel = {
    create: vi.fn(async (input: any) => {
      threads.set(input.id, { ...input });
      return { ...input };
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const existing = threads.get(id);
      if (existing) threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async () => ({
      agentId: null,
      id: 'topic-fixture',
      metadata: {
        runningOperation: { assistantMessageId: 'asst-fixture', operationId: 'op-fixture' },
      },
    })),
    updateMetadata: vi.fn(async (_topicId: string, _patch: any) => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return { handler, messageModel, messages, threadModel, threads, topicModel };
};

const ingest = async (
  h: ReturnType<typeof createHarness>,
  events: AgentStreamEvent[],
  batchSize = 50,
) => {
  for (let i = 0; i < events.length; i += batchSize) {
    await h.handler.ingest({
      events: events.slice(i, i + batchSize),
      operationId: 'op-fixture',
      topicId: 'topic-fixture',
    });
  }
};

describe('HeterogeneousPersistenceHandler — synthetic CC trace fixture', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('replays a multi-step CC-shaped run end-to-end with correct counts and chain shape', async () => {
    const events = buildSyntheticStream();
    expect(events.length).toBeGreaterThan(50);

    const h = createHarness();
    await ingest(h, events);
    await h.handler.finish({ operationId: 'op-fixture', result: 'success' });

    // ─── Tool message invariants ───
    const toolMessages = [...h.messages.values()].filter((m) => m.role === 'tool');
    const expectedTools = TOOLS_PER_STEP * STEP_COUNT;
    const uniqueToolCallIds = new Set(toolMessages.map((m) => m.tool_call_id).filter(Boolean));
    expect(uniqueToolCallIds.size).toBe(expectedTools);
    expect(toolMessages.length).toBe(expectedTools);

    // Every tool message has the result_msg content from `tool_result`.
    expect(toolMessages.every((m) => m.content.startsWith('result of '))).toBe(true);

    // ─── Step-boundary chain shape ───
    const allAssistants = [...h.messages.values()]
      .filter((m) => m.role === 'assistant' && m.threadId == null)
      .sort((a, b) => (a.id === 'asst-fixture' ? -1 : 1));

    // STEP_COUNT-1 new assistants from `stream_start { newStep }` events.
    expect(allAssistants.length).toBe(STEP_COUNT);

    // Each new assistant chains off the LAST tool message of the prior step
    // (renderer parity: "the wire becomes asst → tool → asst → tool → ...").
    for (let i = 1; i < allAssistants.length; i += 1) {
      const parent = h.messages.get(allAssistants[i].parentId!);
      expect(parent?.role).toBe('tool');
    }

    // ─── Bursty-text dedupe key correctness ───
    // The fixture deliberately emits TEXT_CHUNKS_PER_STEP text chunks with
    // identical (stepIndex, type, timestamp) keys but distinct `content`.
    // With the legacy 3-tuple key this would dedupe → truncated content;
    // the fingerprint key keeps each chunk distinct.
    const finalAssistantContent = allAssistants.at(-1)?.content ?? '';
    const lastStep = STEP_COUNT - 1;
    for (let t = 0; t < TEXT_CHUNKS_PER_STEP; t += 1) {
      expect(finalAssistantContent).toContain(`step-${lastStep}-chunk-${t}`);
    }
  });

  it('idempotent under whole-batch retry — no duplicates when the same events are re-ingested', async () => {
    const events = buildSyntheticStream();
    const h = createHarness();

    await ingest(h, events);
    const baselineToolCount = [...h.messages.values()].filter((m) => m.role === 'tool').length;
    const baselineCreateCalls = h.messageModel.create.mock.calls.length;

    // Re-ingest the SAME events without `finish()`. Every event keeps the
    // same fingerprint, so the dedupe map skips them all → no new writes.
    await ingest(h, events);
    const afterReplayToolCount = [...h.messages.values()].filter((m) => m.role === 'tool').length;
    const afterReplayCreateCalls = h.messageModel.create.mock.calls.length;

    expect(afterReplayToolCount).toBe(baselineToolCount);
    expect(afterReplayCreateCalls).toBe(baselineCreateCalls);
  });

  it('partial-batch retry resumes from the failed event without re-creating succeeded ones', async () => {
    const events = buildSyntheticStream();
    const h = createHarness();

    // Make the 7th `messageModel.create` (a tool message creation, mid-batch)
    // throw on its first attempt only.
    let toolCreateAttempts = 0;
    const realCreate = h.messageModel.create.getMockImplementation()!;
    h.messageModel.create.mockImplementation(async (input: any, id?: string) => {
      if (input.role === 'tool') {
        toolCreateAttempts += 1;
        if (toolCreateAttempts === 7) {
          throw new Error('transient db error');
        }
      }
      return realCreate(input, id);
    });

    // First attempt should throw because the 7th tool create fails.
    await expect(ingest(h, events)).rejects.toThrow('transient db error');

    // Retry the SAME batch — the failing tool create is no longer flaky.
    // Succeeded tools are skipped via persistedIds; the failed one + all
    // subsequent events get processed.
    await ingest(h, events);

    // Same final tool count as a clean run: TOOLS_PER_STEP * STEP_COUNT.
    const expected = TOOLS_PER_STEP * STEP_COUNT;
    const toolMessages = [...h.messages.values()].filter((m) => m.role === 'tool');
    expect(new Set(toolMessages.map((m) => m.tool_call_id)).size).toBe(expected);
    expect(toolMessages.length).toBe(expected);
  });
});
