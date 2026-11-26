import { describe, expect, it } from 'vitest';

import { getErrorDetail, toInlineError } from './errorDetail';

describe('getErrorDetail', () => {
  it('returns the message of an Error', () => {
    expect(getErrorDetail(new Error('name already exists'))).toBe('name already exists');
  });

  it('reads message from plain objects such as TRPC client errors', () => {
    expect(getErrorDetail({ message: ' quota exceeded ' })).toBe('quota exceeded');
  });

  it('accepts a string error', () => {
    expect(getErrorDetail('timeout')).toBe('timeout');
  });

  it('drops empty messages and non-error values', () => {
    expect(getErrorDetail(new Error('   '))).toBeUndefined();
    expect(getErrorDetail(undefined)).toBeUndefined();
    expect(getErrorDetail(42)).toBeUndefined();
  });

  it('drops a message that only repeats the summary', () => {
    expect(getErrorDetail(new Error('Save failed'), 'Save failed')).toBeUndefined();
  });
});

describe('toInlineError', () => {
  it('pairs the summary with the raw cause', () => {
    expect(toInlineError("Couldn't save. Try again.", new Error('Duplicate key'))).toEqual({
      detail: 'Duplicate key',
      summary: "Couldn't save. Try again.",
    });
  });
});
