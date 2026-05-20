import { describe, expect, it } from 'vitest';

import type { MockEvent } from '../types';
import { snapshotToEvents } from './snapshotToEvents';

const minimalSnapshot = {
  operationId: 'op-1',
  traceId: 'tr-1',
  startedAt: 1_000_000,
  totalSteps: 2,
  totalTokens: 0,
  totalCost: 0,
  steps: [
    {
      stepIndex: 0,
      stepType: 'call_llm' as const,
      content: 'Hello there.',
      reasoning: 'Plan',
      startedAt: 1_000_000,
      completedAt: 1_000_500,
      executionTimeMs: 500,
      totalTokens: 0,
      totalCost: 0,
      toolsCalling: [{ identifier: 'lobe-todo-write', apiName: 'addTodo', arguments: '{}' }],
    },
    {
      stepIndex: 1,
      stepType: 'call_tool' as const,
      startedAt: 1_000_500,
      completedAt: 1_000_700,
      executionTimeMs: 200,
      totalTokens: 0,
      totalCost: 0,
      toolsResult: [
        {
          identifier: 'lobe-todo-write',
          apiName: 'addTodo',
          state: { success: true },
        },
      ],
    },
  ],
};

const typesOf = (events: MockEvent[]) => events.map((e) => e.type);

describe('snapshotToEvents', () => {
  it('emits agent_runtime_init at start and agent_runtime_end at end', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    expect(events[0].type).toBe('agent_runtime_init');
    expect(events.at(-1)?.type).toBe('agent_runtime_end');
  });

  it('expands call_llm into stream_start → chunks → stream_end', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    const llmStep = events.filter((e) => e.type.startsWith('stream_'));
    expect(llmStep[0].type).toBe('stream_start');
    expect(llmStep.at(-1)?.type).toBe('stream_end');
    const chunks = llmStep.filter((e) => e.type === 'stream_chunk');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('emits tools_calling chunk near end of LLM step', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    const toolsCallingChunk = events.find(
      (e) =>
        e.type === 'stream_chunk' &&
        (e.data as { chunkType: string }).chunkType === 'tools_calling',
    );
    expect(toolsCallingChunk).toBeDefined();
  });

  it('expands call_tool into tool_start → tool_end per tool', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    const toolEvents = events.filter((e) => e.type === 'tool_start' || e.type === 'tool_end');
    expect(toolEvents.map((e) => e.type)).toEqual(['tool_start', 'tool_end']);
  });

  it('wraps step with step_start and step_complete', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    expect(typesOf(events)).toContain('step_start');
    expect(typesOf(events).filter((t) => t === 'step_complete').length).toBe(2);
  });

  it('preserves stepIndex on all events of a step', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    const step1Events = events.filter((e) => (e as any).stepIndex === 1);
    expect(step1Events.every((e) => (e as any).stepIndex === 1)).toBe(true);
  });

  it('computes per-event delay so step duration ~= executionTimeMs', () => {
    const events = snapshotToEvents(minimalSnapshot as any, { targetChunkChars: 5 });
    const totalDelay = events.reduce((sum, e) => sum + (e.delay ?? 0), 0);
    // 500ms LLM + 200ms tool = 700ms
    expect(totalDelay).toBeGreaterThanOrEqual(600);
    expect(totalDelay).toBeLessThanOrEqual(800);
  });
});
