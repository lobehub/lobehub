import { describe, expect, it } from 'vitest';

import { threadVerdict } from './threadVerdict';

describe('threadVerdict', () => {
  it('reads a graded attempt by its verdict, not by its completed status', () => {
    expect(threadVerdict({ passed: true, status: 'completed' })).toBe('passed');
    expect(threadVerdict({ passed: false, status: 'completed' })).toBe('failed');
  });

  it('keeps a finished but ungraded attempt apart from a pending one', () => {
    expect(threadVerdict({ status: 'completed' })).toBe('completed');
    expect(threadVerdict({})).toBe('pending');
  });

  it('names running, external, timeout and error attempts', () => {
    expect(threadVerdict({ status: 'running' })).toBe('running');
    expect(threadVerdict({ status: 'external' })).toBe('external');
    expect(threadVerdict({ status: 'timeout' })).toBe('timeout');
    expect(threadVerdict({ status: 'judge_error' })).toBe('error');
    expect(threadVerdict({ error: 'step cap', passed: false, status: 'failed' })).toBe('error');
  });
});
