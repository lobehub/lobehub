import { describe, expect, it } from 'vitest';

import { actorLast, filterMemberCandidates } from './memberSearch';

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

describe('actorLast', () => {
  it('moves the acting admin to the end of the batch', () => {
    expect(actorLast(['me', 'a', 'b'], 'me')).toEqual(['a', 'b', 'me']);
  });

  it('keeps the order when the actor is not selected or unknown', () => {
    expect(actorLast(['a', 'b'], 'me')).toEqual(['a', 'b']);
    expect(actorLast(['a', 'b'])).toEqual(['a', 'b']);
  });
});
