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
