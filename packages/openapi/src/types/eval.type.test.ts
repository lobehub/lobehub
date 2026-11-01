import { describe, expect, it } from 'vitest';

import { CreateEvalRunRequestSchema } from './eval.type';

describe('CreateEvalRunRequestSchema', () => {
  const base = { datasetId: 'dataset-1', targetAgentId: 'agent-1' };

  it('accepts bounded asynchronous run configuration', () => {
    const parsed = CreateEvalRunRequestSchema.parse({
      ...base,
      config: { k: 3, maxSteps: 50, timeout: 120_000 },
      id: 'external-idempotency-key',
    });
    expect(parsed.config?.k).toBe(3);
  });

  it('rejects out-of-range execution bounds', () => {
    expect(CreateEvalRunRequestSchema.safeParse({ ...base, config: { k: 11 } }).success).toBe(
      false,
    );
    expect(
      CreateEvalRunRequestSchema.safeParse({ ...base, config: { maxSteps: 1001 } }).success,
    ).toBe(false);
    expect(
      CreateEvalRunRequestSchema.safeParse({ ...base, config: { timeout: 1000 } }).success,
    ).toBe(false);
  });

  // Only knobs the run path actually honors belong in the public contract.
  // `caseSelection` is storage-only for internal runs (this endpoint always creates
  // `mode: 'internal'`, which pre-creates topics for every case), and
  // `maxConcurrency` is consumed nowhere — accepting either would silently run the
  // whole dataset or no-op.
  it.each(['caseSelection', 'maxConcurrency'])('rejects the inert config knob %s', (key) => {
    const config = key === 'caseSelection' ? { caseSelection: { mode: 'all' } } : { [key]: 5 };

    expect(CreateEvalRunRequestSchema.safeParse({ ...base, config }).success).toBe(false);
  });
});
