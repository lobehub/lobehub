import { describe, expect, it } from 'vitest';

import { CreateEvalRunRequestSchema } from './eval.type';

describe('CreateEvalRunRequestSchema', () => {
  const base = { datasetId: 'dataset-1', targetAgentId: 'agent-1' };

  it('accepts bounded asynchronous run configuration', () => {
    const parsed = CreateEvalRunRequestSchema.parse({
      ...base,
      config: { k: 3, maxConcurrency: 5, maxSteps: 50, timeout: 120_000 },
      id: 'external-idempotency-key',
    });
    expect(parsed.config?.k).toBe(3);
  });

  it('rejects invalid case selections and execution bounds', () => {
    expect(
      CreateEvalRunRequestSchema.safeParse({
        ...base,
        config: { caseSelection: { mode: 'include' } },
      }).success,
    ).toBe(false);
    expect(
      CreateEvalRunRequestSchema.safeParse({ ...base, config: { maxConcurrency: 21 } }).success,
    ).toBe(false);
  });

  it('canonicalizes an all-cases selection to omission', () => {
    const parsed = CreateEvalRunRequestSchema.parse({
      ...base,
      config: { caseSelection: { mode: 'all' } },
    });
    expect(parsed.config?.caseSelection).toBeUndefined();
  });
});
