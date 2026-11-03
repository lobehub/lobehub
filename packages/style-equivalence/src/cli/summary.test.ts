import { describe, expect, it } from 'vitest';

import { formatSummary } from './summary';

describe('formatSummary', () => {
  it('prints the counts, the top root causes and where the evidence is', () => {
    const text = formatSummary({
      base: '60dee1474d670923619b9243e7863b3de82dcb3c',
      cases: [
        {
          category: 'difference',
          key: 'src/Controls.tsx|SectionHeader#0',
          result: {
            differingConditions: ['light/375/default', 'dark/375/default'],
            rootCauses: [
              {
                after: 'normal',
                before: '"cv01", "kern", "tnum"',
                key: 'root.0',
                property: 'font-feature-settings',
              },
            ],
          },
        },
        {
          category: 'needs-signoff',
          key: 'src/Controls.tsx|ControlLabel#0',
          result: { differingConditions: [], rootCauses: [] },
        },
        {
          category: 'equal',
          key: 'src/A.tsx|A#0',
          result: { differingConditions: [], rootCauses: [] },
        },
        {
          category: 'blocking',
          key: 'src/B.tsx|B#0',
          result: { differingConditions: [], rootCauses: [] },
        },
      ],
      comparisons: 96,
      durationMs: 81_500,
      files: ['src/Controls.tsx', 'src/A.tsx', 'src/B.tsx'],
      head: 'f0a8fd0ce5202864e5c6f8c81dceabaafb7978a3',
      runDir: '/repo/.records/style-equivalence/run-1',
      unpaired: 3,
    });
    expect(text.split('\n')).toEqual([
      'style-equivalence 60dee14..f0a8fd0 · 3 files · 4 cases · 96 comparisons · 82s',
      'difference 1 · needs sign-off 4 · blocking 1 · equal 1',
      'Top root causes:',
      '  src/Controls.tsx|SectionHeader#0  font-feature-settings: "cv01", "kern", "tnum" → normal  (2 conditions)',
      'Evidence: /repo/.records/style-equivalence/run-1',
    ]);
  });
});
