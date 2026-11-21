import { describe, expect, it } from 'vitest';

import { readCheckDispute, tallyDisputeVotes } from './dispute';

describe('readCheckDispute', () => {
  it('returns the dispute filed on the result metadata', () => {
    const dispute = {
      filedAt: '2026-10-01T00:00:00.000Z',
      kind: 'missed_evidence',
      reason: 'See 2',
    };
    expect(readCheckDispute({ dispute, visualization: undefined })).toEqual(dispute);
  });

  it('treats missing or malformed disputes as none', () => {
    expect(readCheckDispute(undefined)).toBeUndefined();
    expect(readCheckDispute(null)).toBeUndefined();
    expect(readCheckDispute({})).toBeUndefined();
    expect(readCheckDispute({ dispute: 'nope' })).toBeUndefined();
    expect(readCheckDispute({ dispute: { kind: 'other', reason: 'x' } })).toBeUndefined();
    expect(readCheckDispute({ dispute: { kind: 'invalid_criterion' } })).toBeUndefined();
  });
});

describe('tallyDisputeVotes', () => {
  it('counts upheld votes over the members that actually ruled', () => {
    expect(
      tallyDisputeVotes({
        decidedAt: '2026-10-01T00:00:00.000Z',
        outcome: 'upheld',
        votes: [
          { model: 'a', provider: 'p', status: 'judged', upheld: true },
          { model: 'b', provider: 'p', status: 'judged', upheld: false },
          { model: 'c', provider: 'p', status: 'judged', upheld: true },
          { model: 'd', provider: 'p', status: 'errored' },
        ],
      }),
    ).toEqual({ errored: 1, judged: 3, upheld: 2 });
  });

  it('handles an empty panel', () => {
    expect(
      tallyDisputeVotes({ decidedAt: '2026-10-01T00:00:00.000Z', outcome: 'undecided', votes: [] }),
    ).toEqual({ errored: 0, judged: 0, upheld: 0 });
  });
});
