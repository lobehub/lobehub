import { describe, expect, it } from 'vitest';

import { coverageGaps, readRequiredEvidence } from '../evidenceCoverage';

describe('readRequiredEvidence', () => {
  it('reads a requiredEvidence array off the verifier config', () => {
    expect(readRequiredEvidence({ requiredEvidence: [{ type: 'screenshot' }] })).toEqual([
      { type: 'screenshot' },
    ]);
  });

  it('returns undefined when absent or malformed', () => {
    expect(readRequiredEvidence({})).toBeUndefined();
    expect(readRequiredEvidence(null)).toBeUndefined();
    expect(readRequiredEvidence({ requiredEvidence: 'screenshot' })).toBeUndefined();
  });
});

describe('coverageGaps', () => {
  it('returns no gaps when the item declares no evidence requirement', () => {
    expect(coverageGaps(undefined, [])).toEqual([]);
    expect(coverageGaps([], [{ type: 'screenshot' }])).toEqual([]);
  });

  it('reports each required type with no matching evidence', () => {
    expect(
      coverageGaps([{ type: 'screenshot' }, { type: 'dom_snapshot' }], [{ type: 'screenshot' }]),
    ).toEqual(['dom_snapshot']);
  });

  it('passes when every required type is present', () => {
    expect(
      coverageGaps([{ type: 'screenshot' }], [{ type: 'screenshot' }, { type: 'text' }]),
    ).toEqual([]);
  });

  it('dedupes repeated required types', () => {
    expect(coverageGaps([{ type: 'screenshot' }, { type: 'screenshot' }], [])).toEqual([
      'screenshot',
    ]);
  });
});
