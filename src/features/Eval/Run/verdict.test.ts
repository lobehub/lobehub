import { describe, expect, it } from 'vitest';

import { countVerdicts, formatErrorReason, getCaseVerdict } from './verdict';

describe('getCaseVerdict', () => {
  it('folds timeout into error and a missing status into pending', () => {
    expect(getCaseVerdict('timeout')).toBe('error');
    expect(getCaseVerdict('error')).toBe('error');
    expect(getCaseVerdict(undefined)).toBe('pending');
    expect(getCaseVerdict(null)).toBe('pending');
    expect(getCaseVerdict('passed')).toBe('passed');
  });
});

describe('countVerdicts', () => {
  it('counts every result into exactly one bucket', () => {
    const counts = countVerdicts([
      { status: 'passed' },
      { status: 'failed' },
      { status: 'timeout' },
      { status: 'error' },
      {},
    ]);
    expect(counts).toMatchObject({ error: 2, failed: 1, passed: 1, pending: 1 });
  });
});

describe('formatErrorReason', () => {
  it('keeps plain text', () => {
    expect(formatErrorReason('  Model not found  ')).toBe('Model not found');
  });

  it('unwraps a JSON envelope to its message', () => {
    expect(formatErrorReason('{"error":{"message":"Rate limited","code":429}}')).toBe(
      'Rate limited',
    );
    expect(formatErrorReason({ message: 'boom' })).toBe('boom');
  });

  it('returns the raw text when JSON has no message', () => {
    expect(formatErrorReason('{"code":500}')).toBe('{"code":500}');
  });

  it('returns undefined for empty input', () => {
    expect(formatErrorReason('')).toBeUndefined();
    expect(formatErrorReason(undefined)).toBeUndefined();
  });
});
