import { describe, expect, it } from 'vitest';

import { resolveCommentMentionName } from './commentMentionName';

const memberProfiles = new Map([
  ['user_member', { fullName: 'Arvin', username: 'arvin' }],
  ['user_nameless', { fullName: null, username: 'nameless' }],
]);

describe('resolveCommentMentionName', () => {
  it('shows a workspace member name for an id-only mention', () => {
    expect(resolveCommentMentionName({ id: 'user_member', memberProfiles })).toBe('Arvin');
  });

  it('falls back to the username when the member has no full name', () => {
    expect(resolveCommentMentionName({ id: 'user_nameless', memberProfiles })).toBe('nameless');
  });

  it('shows the signed-in user name when they are mentioned outside a workspace', () => {
    expect(
      resolveCommentMentionName({
        currentUser: { fullName: 'Lin', id: 'user_self' },
        id: 'user_self',
        memberProfiles: new Map(),
      }),
    ).toBe('Lin');
  });

  it('prefers the current member name over a stale name in the tag', () => {
    expect(resolveCommentMentionName({ id: 'user_member', memberProfiles, name: 'Old' })).toBe(
      'Arvin',
    );
  });

  it('keeps the tag name for someone it cannot resolve', () => {
    expect(resolveCommentMentionName({ id: 'user_former', memberProfiles, name: 'Former' })).toBe(
      'Former',
    );
  });

  it('shows the raw id only as a last resort', () => {
    expect(resolveCommentMentionName({ id: 'user_unknown', memberProfiles })).toBe('user_unknown');
    expect(resolveCommentMentionName({ memberProfiles })).toBeUndefined();
  });
});
