import { describe, expect, it } from 'vitest';

import { filterMemberCandidates } from './memberSearch';

const candidates = [
  { email: 'arvinx@foxmail.com', name: 'Arvin Xu', userId: 'u1' },
  { email: null, name: 'Neko', userId: 'u2' },
];

describe('filterMemberCandidates', () => {
  it('returns everyone for a blank query', () => {
    expect(filterMemberCandidates(candidates, '  ')).toEqual(candidates);
  });

  it('matches name or email case-insensitively', () => {
    expect(filterMemberCandidates(candidates, 'NEK').map(({ userId }) => userId)).toEqual(['u2']);
    expect(filterMemberCandidates(candidates, 'foxmail').map(({ userId }) => userId)).toEqual([
      'u1',
    ]);
  });
});
