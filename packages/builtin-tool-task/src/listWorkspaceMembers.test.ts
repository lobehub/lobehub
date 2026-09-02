import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT,
  matchesMemberQuery,
  normalizeListWorkspaceMembersParams,
  normalizeMemberQuery,
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

describe('normalizeMemberQuery', () => {
  it('unwraps native Slack / Discord mentions and a leading @ into the bare needle', () => {
    expect(normalizeMemberQuery('<@U123>')).toBe('u123');
    expect(normalizeMemberQuery('<@U123|alice>')).toBe('u123');
    expect(normalizeMemberQuery('<@4521>')).toBe('4521');
    expect(normalizeMemberQuery('<@!4521>')).toBe('4521');
    expect(normalizeMemberQuery('  @Neko ')).toBe('neko');
    expect(normalizeMemberQuery('alice@lobehub.com')).toBe('alice@lobehub.com');
    // Nothing usable left: blank, or a bare "@" / empty wrapper.
    expect(normalizeMemberQuery('')).toBeUndefined();
    expect(normalizeMemberQuery('@')).toBeUndefined();
    expect(normalizeMemberQuery('<@>')).toBeUndefined();
  });
});

describe('matchesMemberQuery', () => {
  it('matches an exact id, or a case-insensitive part of name, handle, email or IM identity', () => {
    expect(matchesMemberQuery(alice, 'usr_2')).toBe(true);
    expect(matchesMemberQuery(alice, 'chen')).toBe(true);
    expect(matchesMemberQuery(alice, 'alice')).toBe(true);
    expect(matchesMemberQuery(alice, 'alice@lobehub.com')).toBe(true);
    expect(matchesMemberQuery(alice, 'neko')).toBe(true);
    expect(matchesMemberQuery(alice, '4521')).toBe(true);
    expect(matchesMemberQuery(alice, 'u123')).toBe(true);
    expect(matchesMemberQuery(bob, 'alice')).toBe(false);
    expect(matchesMemberQuery(alice, '')).toBe(false);
  });
});

describe('selectAssignableMembers', () => {
  it('narrows by query and reports the pre-cap total', () => {
    expect(selectAssignableMembers([alice, bob], { query: 'neko' })).toEqual({
      members: [alice],
      query: 'neko',
      total: 1,
    });
    // A native mention pasted through by the model resolves by platform id.
    expect(selectAssignableMembers([alice, bob], { query: '<@!4521>' })).toEqual({
      members: [alice],
      query: '4521',
      total: 1,
    });
    expect(selectAssignableMembers([alice, bob], { query: '<@U123>' }).members).toEqual([alice]);
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
