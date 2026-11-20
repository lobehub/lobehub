import { describe, expect, it } from 'vitest';

import { formatStack, formatSummary } from './summary';

describe('formatSummary', () => {
  it('prints the counts, the top root causes and where the evidence is', () => {
    const text = formatSummary({
      base: '60dee1474d670923619b9243e7863b3de82dcb3c',
      calibration: [
        {
          detail: '',
          file: 'src/Controls.tsx',
          fixture: 'difference',
          fixtureId: 'Controls',
          status: 'agree',
          synthetic: 'difference',
        },
        {
          detail: 'exit 3',
          file: 'src/A.tsx',
          fixture: 'inconclusive',
          fixtureId: 'A',
          status: 'inconclusive',
          synthetic: 'equal',
        },
      ],
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
      mutation: {
        caught: 9,
        equivalent: 2,
        evaluated: 9,
        mutants: [],
        passed: true,
        requested: 10,
      },
      runDir: '/repo/.records/style-equivalence/run-1',
      verdict: {
        items: [
          { category: 'difference', key: 'src/Controls.tsx|SectionHeader#0' },
          { category: 'needs-signoff', key: 'src/Controls.tsx|ControlLabel#0' },
          { category: 'needs-signoff', key: 'src/A.tsx|file' },
          { category: 'equal', key: 'src/A.tsx|A#0' },
          { category: 'blocking', key: 'src/B.tsx|B#0' },
          { category: 'unpaired', key: 'src/B.tsx|unpaired:base:B#1' },
          { category: 'unpaired', key: 'src/B.tsx|unpaired:base:B#2' },
          { category: 'unpaired', key: 'src/B.tsx|unpaired:head:B#3' },
        ],
        mergeable: false,
        reasons: ['blocking 1', 'difference 1', 'needs sign-off 2', 'unpaired 3'],
      },
    });
    expect(text.split('\n')).toEqual([
      'verdict not mergeable: blocking 1 · difference 1 · needs sign-off 2 · unpaired 3',
      'style-equivalence 60dee14..f0a8fd0 · 3 files · 4 cases · 96 comparisons · 82s',
      'difference 1 · needs sign-off 2 (1 cases · 1 files) · unpaired 3 · blocking 1 · equal 1',
      'mutation 9/9 caught · 2 equivalent dropped (requested 10)',
      'calibration 1 agree · 0 mismatch · 1 inconclusive',
      'Top root causes:',
      '  src/Controls.tsx|SectionHeader#0  font-feature-settings: "cv01", "kern", "tnum" → normal  (2 conditions)',
      'Evidence: /repo/.records/style-equivalence/run-1',
    ]);
  });

  it('names the missed mutants when mutation testing fails', () => {
    const text = formatSummary({
      base: 'a'.repeat(40),
      calibration: [
        {
          detail: '',
          file: 'src/B.tsx',
          fixture: 'difference',
          fixtureId: 'B',
          status: 'mismatch',
          synthetic: 'equal',
        },
      ],
      cases: [],
      comparisons: 0,
      durationMs: 0,
      files: [],
      head: 'b'.repeat(40),
      mutation: {
        caught: 1,
        equivalent: 0,
        evaluated: 2,
        mutants: [
          { caseKey: 'src/A.tsx|A#0', description: 'numeric: 8px → 9px', outcome: 'missed' },
          { caseKey: 'src/B.tsx|B#0', description: 'delete-state: &:hover', outcome: 'caught' },
        ],
        passed: false,
        requested: 2,
      },
      runDir: '/r',
      verdict: { items: [], mergeable: false, reasons: ['mutation not fully caught'] },
    });
    expect(text.split('\n')[0]).toBe('verdict not mergeable: mutation not fully caught');
    expect(text.split('\n').slice(3, 7)).toEqual([
      'mutation FAILED 1/2 caught',
      '  missed src/A.tsx|A#0  numeric: 8px → 9px',
      'calibration 0 agree · 1 mismatch · 0 inconclusive',
      '  mismatch B (src/B.tsx): real mount difference, synthetic equal',
    ]);
  });
});

describe('formatStack', () => {
  it('prints one line per PR shard and the conflicts', () => {
    const text = formatStack({
      base: 'a'.repeat(40),
      conflicts: [{ files: ['src/A.tsx'], id: '21459' }],
      head: 'c'.repeat(40),
      mergeable: false,
      merged: ['21446', '21452'],
      resolved: [{ files: ['scripts/legacyFiles.json'], id: '21452' }],
      shards: [
        {
          files: ['x'],
          id: '21446',
          result: { runDir: '/r/1', verdict: { mergeable: true, reasons: [] } },
        },
        {
          files: ['y', 'z'],
          id: '21452',
          result: { runDir: '/r/2', verdict: { mergeable: false, reasons: ['difference 6'] } },
        },
      ],
    });
    expect(text.split('\n')).toEqual([
      'stack verdict not mergeable · aaaaaaa..ccccccc · merged 2 · conflicts 1 · shards 2',
      '  conflict #21459  src/A.tsx',
      '  kept stack side #21452  scripts/legacyFiles.json',
      '  #21446  mergeable  (1 files)  /r/1',
      '  #21452  not mergeable: difference 6  (2 files)  /r/2',
    ]);
  });
});
