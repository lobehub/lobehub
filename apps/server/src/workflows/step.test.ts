import { describe, expect, it } from 'vitest';

import { parseWorkflowDate, runStep, type WorkflowStepResult } from './step';
import { createStepRunner } from './testing/stepContext';

describe('runStep', () => {
  it('types a step result the way the workflow receives it after the JSON round trip', async () => {
    const context = { run: createStepRunner() };

    const result = await runStep(context, 'load', () => ({
      id: 'topic-1',
      updatedAt: new Date('2026-07-31T10:00:00Z'),
    }));

    // The compiler now agrees with the runtime: `updatedAt` is a string on both sides.
    const updatedAt: string = result.updatedAt;
    expect(updatedAt).toBe('2026-07-31T10:00:00.000Z');
    expect(context.run).toHaveBeenCalledWith('load', expect.any(Function));
  });

  it('maps nested and array timestamps, and leaves other values untouched', async () => {
    const context = { run: createStepRunner() };

    const result = await runStep(context, 'list', () => ({
      cursor: { createdAt: new Date('2026-07-31T10:00:00Z'), id: 'user-1' },
      enabled: true,
      rows: [{ at: new Date('2026-07-31T11:00:00Z') }],
      total: 2,
    }));

    const cursorCreatedAt: string = result.cursor.createdAt;
    const rowAt: string = result.rows[0].at;
    expect(cursorCreatedAt).toBe('2026-07-31T10:00:00.000Z');
    expect(rowAt).toBe('2026-07-31T11:00:00.000Z');
    expect(result.enabled).toBe(true);
    expect(result.total).toBe(2);
  });

  it('passes an undefined step result through untouched', async () => {
    const context = { run: createStepRunner() };

    await expect(runStep(context, 'noop', () => undefined)).resolves.toBeUndefined();
  });
});

describe('WorkflowStepResult', () => {
  it('collapses Date to string while preserving the rest of the shape', () => {
    type Candidate = { at: Date; nested: { since: Date | null }; tags: string[] };
    type Serialized = WorkflowStepResult<Candidate>;

    const value: Serialized = { at: 'iso', nested: { since: null }, tags: ['a'] };

    expect(value.at).toBe('iso');
  });
});

describe('parseWorkflowDate', () => {
  it('accepts both a live Date and a round-tripped ISO string', () => {
    const date = new Date('2026-07-31T10:00:00Z');

    expect(parseWorkflowDate(date).toISOString()).toBe('2026-07-31T10:00:00.000Z');
    expect(parseWorkflowDate('2026-07-31T10:00:00.000Z').toISOString()).toBe(
      '2026-07-31T10:00:00.000Z',
    );
  });

  it('throws a labelled error instead of letting an Invalid Date reach a query', () => {
    expect(() => parseWorkflowDate('not-a-date', 'Invalid cursor')).toThrow(
      'Invalid cursor: not-a-date',
    );
  });
});
