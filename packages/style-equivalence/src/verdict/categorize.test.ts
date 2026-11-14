import { describe, expect, it } from 'vitest';

import { categorizeCase, differsOnlyUnmasked } from './categorize';

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

  it('sends a difference that appears only with the inline style absent to sign-off', () => {
    const masked = {
      combos: [{ __inlineStyle: true }, { __inlineStyle: false }],
      flags: [],
    };
    const only = (combo: number) => ({
      comboDifferences: [{ combo }],
      gaps: [],
      status: 'difference' as const,
    });
    expect(categorizeCase(masked, only(1) as never)).toBe('needs-signoff');
    expect(differsOnlyUnmasked(masked, only(1) as never)).toBe(true);
    expect(categorizeCase(masked, only(0) as never)).toBe('difference');
    expect(differsOnlyUnmasked(masked, only(0) as never)).toBe(false);
    expect(differsOnlyUnmasked({ combos: [{}], flags: [] }, only(0) as never)).toBe(false);
  });
});
