import { describe, expect, it } from 'vitest';

import { AsyncTaskErrorType } from '@/types/asyncTask';
import { LayersEnum } from '@/types/userMemory';

import {
  buildAsyncTaskErrorFrom,
  classifyExtractionError,
  describeError,
  MemoryExtractionAggregateError,
} from '../extract/errors';
import { splitExtractorContextBudget } from '../extract/extractTopic';
import { normalizeLayerError } from '../extract/persistExtraction';

// The shape model runtimes throw: a plain payload, not an Error.
const runtimeError = {
  error: { error: { code: 429, message: 'You exceeded your current quota' } },
  errorType: 'QuotaLimitReached',
  provider: 'google',
};

describe('describeError', () => {
  it('names the provider, error type and upstream message of a runtime payload', () => {
    expect(describeError(runtimeError)).toBe(
      'google QuotaLimitReached: You exceeded your current quota',
    );
  });

  it('keeps Error messages and strings, and serializes unknown objects', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ status: 503 })).toBe('{"status":503}');
  });

  it('clips long messages', () => {
    expect(describeError('x'.repeat(600))).toHaveLength(501);
  });
});

describe('extraction errors no longer lose their cause', () => {
  it('layer errors carry the readable message and the original as cause', () => {
    const error = normalizeLayerError(LayersEnum.Context, 'extract', runtimeError);

    expect(error.message).not.toContain('[object Object]');
    expect(error.message).toContain('google QuotaLimitReached: You exceeded your current quota');
    expect(error.cause).toBe(runtimeError);
  });

  it('task errors describe a non-Error instead of a generic failure', () => {
    const task = buildAsyncTaskErrorFrom(runtimeError) as { body: { detail: string } };

    expect(task.body.detail).toBe('google QuotaLimitReached: You exceeded your current quota');
  });
});

describe('failures that are not ours are typed apart', () => {
  it('records an exhausted budget as SubscriptionPlanLimit', () => {
    const task = buildAsyncTaskErrorFrom({
      error: {},
      errorType: 'InsufficientBudgetForModel',
      message: 'Budget exceeded',
      provider: 'lobehub',
    }) as { name: string };

    expect(task.name).toBe(AsyncTaskErrorType.SubscriptionPlanLimit);
  });

  it('records a provider content block as ProviderContentModeration', () => {
    const task = buildAsyncTaskErrorFrom(
      new Error('400 request blocked by (PROHIBITED_CONTENT): content is prohibited'),
    ) as { name: string };

    expect(task.name).toBe(AsyncTaskErrorType.ProviderContentModeration);
  });

  it('classifies layer errors by their messages', () => {
    const task = buildAsyncTaskErrorFrom(
      new MemoryExtractionAggregateError(
        'Memory extraction encountered layer errors: [extract] activities: lobehub InsufficientBudgetForModel: Budget exceeded',
        [],
      ),
    ) as { name: string };

    expect(task.name).toBe(AsyncTaskErrorType.SubscriptionPlanLimit);
  });

  it('keeps other failures as ServerError', () => {
    expect((buildAsyncTaskErrorFrom(new Error('boom')) as { name: string }).name).toBe(
      AsyncTaskErrorType.ServerError,
    );
    expect(classifyExtractionError('lobehub ExceededContextWindow: 400')).toBeUndefined();
  });
});

describe('splitExtractorContextBudget', () => {
  it('keeps the parts together within the limit', () => {
    const budget = splitExtractorContextBudget(100_000);

    expect(budget.topic + budget.memories + budget.identities).toBeLessThanOrEqual(100_000);
    expect(budget.topic).toBeGreaterThan(budget.memories);
  });

  it('leaves trimming off when no limit is configured', () => {
    expect(splitExtractorContextBudget(undefined)).toEqual({
      identities: undefined,
      memories: undefined,
      topic: undefined,
    });
  });
});
