import { describe, expect, it } from 'vitest';

import type { StepSnapshot } from '../types';
import { resolveCeSnapshot } from './index';

const ceStep = (
  stepIndex: number,
  contextEngine?: StepSnapshot['contextEngine'],
): StepSnapshot => ({
  completedAt: 2_000,
  contextEngine,
  executionTimeMs: 1_000,
  startedAt: 1_000,
  stepIndex,
  stepType: 'call_llm',
  totalCost: 0,
  totalTokens: 0,
});

describe('resolveCeSnapshot', () => {
  it('resolves metadata stored on the step itself', () => {
    const step = ceStep(0, {
      input: { toolCount: 3 },
      metadata: { staleToolResultTrim: { savedChars: 100, trimmedMessages: 2 } },
      output: [{ role: 'user' }],
    });

    expect(resolveCeSnapshot(step)).toEqual({
      input: { toolCount: 3 },
      metadata: { staleToolResultTrim: { savedChars: 100, trimmedMessages: 2 } },
      output: [{ role: 'user' }],
    });
  });

  it('walks back to find metadata stripped by dedup', () => {
    const steps = [
      ceStep(0, {
        input: { toolCount: 3 },
        metadata: { staleToolResultTrim: { savedChars: 100 } },
        output: [{ role: 'user' }],
      }),
      // dedup stripped everything: identical to step 0
      ceStep(1, {}),
    ];

    expect(resolveCeSnapshot(steps[1], steps)).toEqual({
      input: { toolCount: 3 },
      metadata: { staleToolResultTrim: { savedChars: 100 } },
      output: [{ role: 'user' }],
    });
  });

  it('resolves a changed metadata independently of unchanged input/output', () => {
    const steps = [
      ceStep(0, {
        input: { toolCount: 3 },
        metadata: { staleToolResultTrim: { savedChars: 100 } },
        output: [{ role: 'user' }],
      }),
      ceStep(1, { metadata: { staleToolResultTrim: { savedChars: 250 } } }),
    ];

    expect(resolveCeSnapshot(steps[1], steps)).toEqual({
      input: { toolCount: 3 },
      metadata: { staleToolResultTrim: { savedChars: 250 } },
      output: [{ role: 'user' }],
    });
  });

  it('returns undefined metadata when no step ever stored it', () => {
    const steps = [ceStep(0, { input: { toolCount: 3 }, output: [] }), ceStep(1, {})];

    expect(resolveCeSnapshot(steps[1], steps)).toEqual({
      input: { toolCount: 3 },
      metadata: undefined,
      output: [],
    });
  });
});

describe('resolveCeSnapshot — pooled refs', () => {
  const m1 = { content: 'one', role: 'user' };
  const m2 = { content: 'two', role: 'assistant' };

  it('resolves refs whatever order the steps are stored in', () => {
    const steps = [
      ceStep(2, { inputRefs: { toolCount: 'r3' }, outputRef: 'n2' }),
      ceStep(0, {
        inputRefs: { toolCount: 'r3' },
        outputRef: 'n1',
        pool: { m1, n1: { refs: ['m1'] }, r3: 3 },
      }),
      ceStep(1, { outputRef: 'n1', pool: { m2, n2: { base: 'n1', refs: ['m2'] } } }),
    ];

    expect(resolveCeSnapshot(steps[0], steps)).toEqual({
      input: { toolCount: 3 },
      metadata: undefined,
      output: [m1, m2],
    });
    // Step 1 pooled n2 but only references n1; its input carries over from step 0.
    expect(resolveCeSnapshot(steps[2], steps)?.output).toEqual([m1]);
    expect(resolveCeSnapshot(steps[2], steps)?.input).toEqual({ toolCount: 3 });
  });

  it('fails loudly when a referenced pool entry is missing', () => {
    const steps = [ceStep(0, { outputRef: 'gone' })];

    expect(() => resolveCeSnapshot(steps[0], steps)).toThrow(/gone .*step 0 is missing/);
  });

  it('fails instead of looping on a cyclic output list', () => {
    const steps = [
      ceStep(0, {
        outputRef: 'a',
        pool: { a: { base: 'b', refs: [] }, b: { base: 'a', refs: [] } },
      }),
    ];

    expect(() => resolveCeSnapshot(steps[0], steps)).toThrow(/cyclic/);
  });
});
