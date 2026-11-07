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

  it('ignores unmodeled gaps on an element whose own chain and file rules did not change', () => {
    const unchanged = { evidence: ['STYLE_CHAIN_UNCHANGED', 'FILE_RULES_UNCHANGED'], flags: [] };
    expect(categorizeCase(unchanged, { gaps: ['PSEUDO_UNMODELED'], status: 'equal' })).toBe(
      'equal',
    );
    expect(
      categorizeCase(
        { evidence: ['STYLE_CHAIN_UNCHANGED'], flags: [] },
        { gaps: ['PSEUDO_UNMODELED'], status: 'equal' },
      ),
    ).toBe('needs-signoff');
    expect(categorizeCase(unchanged, { gaps: [], status: 'difference' })).toBe('difference');
  });
});
