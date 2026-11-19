import { describe, expect, it } from 'vitest';

import { agentDispatchPolicy } from './agentDispatchPolicy';

describe('agentDispatchPolicy (open source)', () => {
  it.each([
    ['online', true],
    ['idle', true],
    ['working', true],
    ['sleeping', true],
    ['waking', true],
    ['offline', false],
    ['offDuty', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(agentDispatchPolicy.canTakeUnaddressed({ activeJobs: 5, status })).toBe(expected);
  });
});
