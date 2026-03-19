import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot, StepSnapshot } from '../types';
import {
  expandSnapshot,
  isIncrementalFormat,
  reconstructActivatedStepTools,
  reconstructMessages,
  reconstructToolsetBaseline,
} from './reconstruct';

function makeStep(overrides: Partial<StepSnapshot>): StepSnapshot {
  return {
    completedAt: 0,
    executionTimeMs: 0,
    startedAt: 0,
    stepIndex: 0,
    stepType: 'call_llm',
    totalCost: 0,
    totalTokens: 0,
    ...overrides,
  };
}

describe('reconstructMessages', () => {
  it('should reconstruct messages for step 0 (baseline)', () => {
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [{ content: 'hi', role: 'assistant' }],
        stepIndex: 0,
      }),
    ];

    const result = reconstructMessages(steps, 0);

    expect(result.messages).toEqual([{ content: 'hello', role: 'user' }]);
    expect(result.messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);
  });

  it('should accumulate deltas across multiple steps', () => {
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [{ content: 'hi', role: 'assistant' }],
        stepIndex: 0,
      }),
      makeStep({
        messagesDelta: [{ content: 'search result', role: 'tool' }],
        stepIndex: 1,
        stepType: 'call_tool',
      }),
      makeStep({
        messagesDelta: [{ content: 'based on results...', role: 'assistant' }],
        stepIndex: 2,
      }),
    ];

    const step1 = reconstructMessages(steps, 1);
    expect(step1.messages).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);
    expect(step1.messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
      { content: 'search result', role: 'tool' },
    ]);

    const step2 = reconstructMessages(steps, 2);
    expect(step2.messages).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
      { content: 'search result', role: 'tool' },
    ]);
    expect(step2.messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
      { content: 'search result', role: 'tool' },
      { content: 'based on results...', role: 'assistant' },
    ]);
  });

  it('should handle compression reset with new baseline', () => {
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [{ content: 'response 1', role: 'assistant' }],
        stepIndex: 0,
      }),
      makeStep({
        messagesDelta: [{ content: 'tool output', role: 'tool' }],
        stepIndex: 1,
        stepType: 'call_tool',
      }),
      // Compression resets baseline
      makeStep({
        isCompressionReset: true,
        messagesBaseline: [{ content: 'compressed summary', role: 'system' }],
        messagesDelta: [{ content: 'post-compression response', role: 'assistant' }],
        stepIndex: 2,
      }),
    ];

    const result = reconstructMessages(steps, 2);
    // After compression, baseline replaces everything
    expect(result.messages).toEqual([{ content: 'compressed summary', role: 'system' }]);
    expect(result.messagesAfter).toEqual([
      { content: 'compressed summary', role: 'system' },
      { content: 'post-compression response', role: 'assistant' },
    ]);
  });

  it('should handle steps after compression baseline', () => {
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [{ content: 'r1', role: 'assistant' }],
        stepIndex: 0,
      }),
      makeStep({
        isCompressionReset: true,
        messagesBaseline: [{ content: 'summary', role: 'system' }],
        messagesDelta: [{ content: 'r2', role: 'assistant' }],
        stepIndex: 1,
      }),
      makeStep({
        messagesDelta: [{ content: 'tool', role: 'tool' }],
        stepIndex: 2,
        stepType: 'call_tool',
      }),
    ];

    const result = reconstructMessages(steps, 2);
    expect(result.messages).toEqual([
      { content: 'summary', role: 'system' },
      { content: 'r2', role: 'assistant' },
    ]);
    expect(result.messagesAfter).toEqual([
      { content: 'summary', role: 'system' },
      { content: 'r2', role: 'assistant' },
      { content: 'tool', role: 'tool' },
    ]);
  });

  it('should not duplicate baseline messages in delta (P1 regression)', () => {
    // Simulates what AgentRuntimeService records:
    // prevMessages = [user], afterMessages = [user, assistant]
    // delta should be [assistant] only, NOT [user, assistant]
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [{ content: 'hi', role: 'assistant' }], // correct: only new msg
        stepIndex: 0,
      }),
      makeStep({
        messagesDelta: [{ content: 'tool result', role: 'tool' }],
        stepIndex: 1,
        stepType: 'call_tool',
      }),
      makeStep({
        messagesDelta: [{ content: 'final answer', role: 'assistant' }],
        stepIndex: 2,
      }),
    ];

    // Verify the chain reconstructs correctly without duplication
    const step2 = reconstructMessages(steps, 2);
    expect(step2.messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
      { content: 'tool result', role: 'tool' },
      { content: 'final answer', role: 'assistant' },
    ]);
    // Each message appears exactly once
    expect(step2.messagesAfter).toHaveLength(4);
  });

  it('should handle empty delta', () => {
    const steps: StepSnapshot[] = [
      makeStep({
        messagesBaseline: [{ content: 'hello', role: 'user' }],
        messagesDelta: [],
        stepIndex: 0,
      }),
    ];

    const result = reconstructMessages(steps, 0);
    expect(result.messages).toEqual([{ content: 'hello', role: 'user' }]);
    expect(result.messagesAfter).toEqual([{ content: 'hello', role: 'user' }]);
  });
});

describe('isIncrementalFormat', () => {
  it('should return true for incremental snapshots', () => {
    const snapshot = {
      steps: [makeStep({ messagesDelta: [], stepIndex: 0 })],
    } as ExecutionSnapshot;

    expect(isIncrementalFormat(snapshot)).toBe(true);
  });

  it('should return false for legacy snapshots', () => {
    const snapshot = {
      steps: [makeStep({ messages: [], stepIndex: 0 })],
    } as ExecutionSnapshot;

    expect(isIncrementalFormat(snapshot)).toBe(false);
  });
});

describe('expandSnapshot', () => {
  it('should expand incremental snapshot to legacy format', () => {
    const snapshot = {
      steps: [
        makeStep({
          messagesBaseline: [{ content: 'hello', role: 'user' }],
          messagesDelta: [{ content: 'hi', role: 'assistant' }],
          stepIndex: 0,
        }),
        makeStep({
          messagesDelta: [{ content: 'tool result', role: 'tool' }],
          stepIndex: 1,
          stepType: 'call_tool',
        }),
      ],
    } as ExecutionSnapshot;

    const expanded = expandSnapshot(snapshot);

    expect(expanded.steps[0].messages).toEqual([{ content: 'hello', role: 'user' }]);
    expect(expanded.steps[0].messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);
    expect(expanded.steps[1].messages).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);
    expect(expanded.steps[1].messagesAfter).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
      { content: 'tool result', role: 'tool' },
    ]);
  });

  it('should return legacy snapshot as-is', () => {
    const snapshot = {
      steps: [
        makeStep({
          messages: [{ content: 'hello', role: 'user' }],
          messagesAfter: [
            { content: 'hello', role: 'user' },
            { content: 'hi', role: 'assistant' },
          ],
          stepIndex: 0,
        }),
      ],
    } as ExecutionSnapshot;

    const result = expandSnapshot(snapshot);
    expect(result).toBe(snapshot); // Same reference — no expansion needed
  });
});

describe('reconstructToolsetBaseline', () => {
  it('should return toolset from step 0', () => {
    const toolset = { enabledToolIds: ['search'], manifestMap: { search: {} } };
    const steps: StepSnapshot[] = [
      makeStep({ stepIndex: 0, toolsetBaseline: toolset }),
      makeStep({ stepIndex: 1, stepType: 'call_tool' }),
    ];

    expect(reconstructToolsetBaseline(steps)).toEqual(toolset);
  });

  it('should return undefined when no toolset baseline exists', () => {
    const steps: StepSnapshot[] = [makeStep({ stepIndex: 0 })];

    expect(reconstructToolsetBaseline(steps)).toBeUndefined();
  });
});

describe('reconstructActivatedStepTools', () => {
  it('should accumulate deltas across steps', () => {
    const steps: StepSnapshot[] = [
      makeStep({ stepIndex: 0 }),
      makeStep({
        activatedStepToolsDelta: [{ activatedAtStep: 1, id: 'local-system', source: 'device' }],
        stepIndex: 1,
        stepType: 'call_tool',
      }),
      makeStep({ stepIndex: 2 }),
      makeStep({
        activatedStepToolsDelta: [{ activatedAtStep: 3, id: 'mcp-tool', source: 'discovery' }],
        stepIndex: 3,
        stepType: 'call_tool',
      }),
    ];

    expect(reconstructActivatedStepTools(steps, 1)).toEqual([
      { activatedAtStep: 1, id: 'local-system', source: 'device' },
    ]);

    expect(reconstructActivatedStepTools(steps, 3)).toEqual([
      { activatedAtStep: 1, id: 'local-system', source: 'device' },
      { activatedAtStep: 3, id: 'mcp-tool', source: 'discovery' },
    ]);
  });

  it('should return empty array when no tools activated', () => {
    const steps: StepSnapshot[] = [makeStep({ stepIndex: 0 }), makeStep({ stepIndex: 1 })];

    expect(reconstructActivatedStepTools(steps, 1)).toEqual([]);
  });
});
