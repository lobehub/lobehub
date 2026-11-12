import { describe, expect, it } from 'vitest';

import { LayersEnum } from '@/types/userMemory';

import { buildAsyncTaskErrorFrom, describeError } from '../extract/errors';
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
