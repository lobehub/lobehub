import { describe, expect, it } from 'vitest';

import { resolveProjectStatus } from './ExecutionStatus';

describe('resolveProjectStatus', () => {
  it('preserves supported project statuses', () => {
    expect(resolveProjectStatus('active')).toBe('active');
    expect(resolveProjectStatus('completed')).toBe('completed');
  });

  it('falls back to backlog for missing or unknown persisted values', () => {
    expect(resolveProjectStatus(undefined)).toBe('backlog');
    expect(resolveProjectStatus(null)).toBe('backlog');
    expect(resolveProjectStatus('in_progress')).toBe('backlog');
  });
});
