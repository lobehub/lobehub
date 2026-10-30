import { describe, expect, it } from 'vitest';

import { coverageGaps, executionGapTypes } from './evidenceCoverage';
import { terminalRecord } from './terminalEvidence.fixture';

const captured = { metadata: { terminal: terminalRecord() }, type: 'terminal' as const };
const authored = {
  metadata: {
    terminal: terminalRecord({
      capture: { ...terminalRecord().capture, mode: 'import' },
      source: { kind: 'authored' },
    }),
  },
  type: 'terminal' as const,
};

describe('coverageGaps', () => {
  it('lets a terminal evidence stand in for text and transcript, but nothing stand in for terminal', () => {
    expect(coverageGaps([{ type: 'text' }, { type: 'transcript' }], [captured])).toEqual([]);
    expect(coverageGaps([{ type: 'terminal' }], [{ type: 'text' }])).toEqual(['terminal']);
  });

  it('matches an execution requirement only against real execution evidence', () => {
    const required = [{ provenance: 'execution' as const, type: 'terminal' as const }];
    expect(coverageGaps(required, [captured])).toEqual([]);
    // An authored example, however it is packaged, never covers it.
    expect(coverageGaps(required, [authored])).toEqual(['terminal']);
    // Nor does a bare log: format compatibility is not execution.
    expect(
      coverageGaps([{ provenance: 'execution', type: 'text' }], [{ type: 'text' }, authored]),
    ).toEqual(['text']);
    expect(coverageGaps([{ provenance: 'execution', type: 'text' }], [captured])).toEqual([]);
  });

  it('keeps medium-only requirements satisfied by authored examples', () => {
    expect(coverageGaps([{ type: 'terminal' }], [authored])).toEqual([]);
  });

  it('names which gaps are execution gaps', () => {
    const required = [
      { provenance: 'execution' as const, type: 'terminal' as const },
      { type: 'screenshot' as const },
    ];
    expect(executionGapTypes(required, coverageGaps(required, [authored]))).toEqual(['terminal']);
  });
});
