import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT,
  matchesMemberQuery,
  normalizeListWorkspaceMembersParams,
  selectAssignableMembers,
} from './listWorkspaceMembers';

const alice = {
  email: 'alice@lobehub.com',
  id: 'usr_2',
  imAccounts: ['discord:@Neko(4521)', 'slack:U123'],
  name: 'Alice Chen',
  username: 'alice',
};
const bob = { id: 'usr_4', name: 'Bob Li', username: 'bob' };

describe('normalizeListWorkspaceMembersParams', () => {
  it('defaults the cap, clamps it into range and folds the query', () => {
    expect(normalizeListWorkspaceMembersParams()).toEqual({
      limit: DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT,
      query: undefined,
    });
    expect(normalizeListWorkspaceMembersParams({ limit: 0, query: '  Neko ' })).toEqual({
      limit: 1,
      query: 'neko',
    });
    expect(normalizeListWorkspaceMembersParams({ limit: 10_000, query: '' }).limit).toBe(100);
  });
});

describe('matchesMemberQuery', () => {
  it('matches an exact id, or a case-insensitive part of name, handle, email or IM identity', () => {
    expect(matchesMemberQuery(alice, 'usr_2')).toBe(true);
    expect(matchesMemberQuery(alice, 'chen')).toBe(true);
    expect(matchesMemberQuery(alice, '@alice')).toBe(true);
    expect(matchesMemberQuery(alice, 'alice@lobehub.com')).toBe(true);
    expect(matchesMemberQuery(alice, '@neko')).toBe(true);
    expect(matchesMemberQuery(alice, '4521')).toBe(true);
    expect(matchesMemberQuery(alice, 'u123')).toBe(true);
    expect(matchesMemberQuery(bob, 'alice')).toBe(false);
    // A bare "@" narrows nothing rather than matching everyone.
    expect(matchesMemberQuery(alice, '@')).toBe(false);
  });
});

describe('selectAssignableMembers', () => {
  it('narrows by query and reports the pre-cap total', () => {
    expect(selectAssignableMembers([alice, bob], { query: 'neko' })).toEqual({
      members: [alice],
      query: 'neko',
      total: 1,
    });
    expect(selectAssignableMembers([alice, bob], { limit: 1 })).toEqual({
      members: [alice],
      query: undefined,
      total: 2,
    });
    expect(selectAssignableMembers([alice, bob])).toEqual({
      members: [alice, bob],
      query: undefined,
      total: 2,
    });
  });
});
