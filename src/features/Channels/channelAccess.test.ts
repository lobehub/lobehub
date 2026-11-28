import type { ChannelDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { canInviteMembers, visibleChannelDetail } from './channelAccess';

describe('Channel access after revalidation', () => {
  const cached = { channel: { title: 'Previously accessible' } } as ChannelDetail;
  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])('hides retained content after %s', (code) => {
    expect(visibleChannelDetail(cached, { data: { code } })).toBeUndefined();
  });
  it('retains content on transient transport failures', () => {
    expect(visibleChannelDetail(cached, new Error('network unavailable'))).toBe(cached);
    expect(visibleChannelDetail(cached, undefined)).toBe(cached);
  });
});

describe('inviting members', () => {
  const open = { canDelete: false, canInvite: true, status: 'active' } as const;
  it('lets any member invite from an open Channel', () => {
    expect(canInviteMembers(open)).toBe(true);
  });
  it('falls back to the admin right when the server does not say', () => {
    expect(canInviteMembers({ canDelete: true, status: 'active' })).toBe(true);
    expect(canInviteMembers({ canDelete: false, status: 'active' })).toBe(false);
  });
  it.each([
    ['a reader who has not joined', { canInvite: false }],
    ['an archived Channel', { status: 'archived' as const }],
  ])('offers no invite to %s', (_, override) => {
    expect(canInviteMembers({ ...open, ...override })).toBe(false);
  });
});
