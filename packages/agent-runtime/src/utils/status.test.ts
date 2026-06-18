import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types/state';
import { isBlockedStatus, isParkedStatus } from './status';

const ALL_STATUSES: AgentState['status'][] = [
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
  'done',
  'error',
  'interrupted',
];

describe('isParkedStatus', () => {
  it('is true only for the non-terminal resumable pauses', () => {
    expect(isParkedStatus('waiting_for_human')).toBe(true);
    expect(isParkedStatus('waiting_for_async_tool')).toBe(true);
  });

  it('is false for running, terminal, and interrupted', () => {
    const nonParked = ALL_STATUSES.filter(
      (s) => s !== 'waiting_for_human' && s !== 'waiting_for_async_tool',
    );
    for (const status of nonParked) expect(isParkedStatus(status)).toBe(false);
  });
});

describe('isBlockedStatus', () => {
  it('is true for parked statuses and user interrupt', () => {
    expect(isBlockedStatus('waiting_for_human')).toBe(true);
    expect(isBlockedStatus('waiting_for_async_tool')).toBe(true);
    expect(isBlockedStatus('interrupted')).toBe(true);
  });

  it('is false for idle, running, and terminal statuses', () => {
    expect(isBlockedStatus('idle')).toBe(false);
    expect(isBlockedStatus('running')).toBe(false);
    expect(isBlockedStatus('done')).toBe(false);
    expect(isBlockedStatus('error')).toBe(false);
  });
});
