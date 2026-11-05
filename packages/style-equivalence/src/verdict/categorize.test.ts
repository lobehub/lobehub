import { describe, expect, it } from 'vitest';

import { categorizeCase } from './categorize';

const plan = (flags: string[] = []) => ({ flags }) as never;

describe('categorizeCase', () => {
  it('sends an equal case with an unmodeled gap to sign-off', () => {
    expect(categorizeCase(plan(), { gaps: ['CONTAINER_UNMODELED'], status: 'equal' })).toBe(
      'needs-signoff',
    );
    expect(categorizeCase(plan(), { gaps: [], status: 'equal' })).toBe('equal');
    expect(categorizeCase(plan(['CROSS_COMPONENT']), { gaps: [], status: 'difference' })).toBe(
      'difference',
    );
  });
});
