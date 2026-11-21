import type { ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isCurrentUserAuthor, isCurrentUserMember } from './memberName';

const author = (
  patch: Partial<ChannelPublicMessage['author']> = {},
): ChannelPublicMessage['author'] => ({
  avatar: null,
  id: 'self',
  name: 'Local Testing',
  type: 'user',
  ...patch,
});

describe('Channel personal avatar ownership', () => {
  it('identifies the viewer in mention lists by actor type and user id, not the member id', () => {
    expect(isCurrentUserMember({ actorType: 'user', userId: 'self' }, 'self')).toBe(true);
    expect(isCurrentUserMember({ actorType: 'user', userId: 'other' }, 'self')).toBe(false);
    expect(isCurrentUserMember({ actorType: 'agent', userId: 'self' }, 'self')).toBe(false);
    expect(isCurrentUserMember({ actorType: 'user', userId: null }, undefined)).toBe(false);
  });
  it('uses the personal avatar component for self even when the channel profile has no avatar', () => {
    expect(isCurrentUserAuthor(author(), 'self')).toBe(true);
  });
  it('uses the live personal avatar rather than a stale avatar in the message response', () => {
    expect(isCurrentUserAuthor(author({ avatar: '/old-avatar.png' }), 'self')).toBe(true);
  });
  it('never borrows the viewer avatar for a different member, even with the same name', () => {
    expect(isCurrentUserAuthor(author({ id: 'other' }), 'self')).toBe(false);
  });
  it('never substitutes a personal avatar for an Agent', () => {
    expect(isCurrentUserAuthor(author({ type: 'agent' }), 'self')).toBe(false);
  });
  it('does not identify a deleted member or an unresolved viewer as self', () => {
    expect(isCurrentUserAuthor(author({ id: null }), 'self')).toBe(false);
    expect(isCurrentUserAuthor(author(), undefined)).toBe(false);
  });
});
