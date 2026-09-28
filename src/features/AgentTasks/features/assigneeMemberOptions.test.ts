import { describe, expect, it } from 'vitest';

import { partitionSelfMember } from './assigneeMemberOptions';

const members = [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }];

describe('partitionSelfMember', () => {
  it('pulls the viewer out of the member list', () => {
    const { others, self } = partitionSelfMember(members, 'user-2');

    expect(self?.userId).toBe('user-2');
    expect(others.map((member) => member.userId)).toEqual(['user-1', 'user-3']);
  });

  it('keeps the list untouched when the viewer is not an assignable member', () => {
    const { others, self } = partitionSelfMember(members, 'user-9');

    expect(self).toBeUndefined();
    expect(others).toEqual(members);
  });

  it('keeps the list untouched when the viewer is unknown', () => {
    expect(partitionSelfMember(members, null)).toEqual({ others: members });
    expect(partitionSelfMember(members, undefined)).toEqual({ others: members });
  });

  it('leaves no other member for a private task the viewer created', () => {
    const { others, self } = partitionSelfMember([{ userId: 'user-1' }], 'user-1');

    expect(self?.userId).toBe('user-1');
    expect(others).toEqual([]);
  });
});
