import type { ChannelDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { canInviteMembers, showsListedShell, visibleChannelDetail } from './channelAccess';

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
  const open = { canDelete: true, status: 'active' } as const;
  it('lets an admin invite from an open Channel', () => {
    expect(canInviteMembers(open)).toBe(true);
  });
  it.each([
    ['a plain member', { canDelete: false }],
    ['an archived Channel', { status: 'archived' as const }],
  ])('offers no invite to %s', (_, override) => {
    expect(canInviteMembers({ ...open, ...override })).toBe(false);
  });
});

describe('opening a Channel before its conversation loads', () => {
  it('stands in with the sidebar row for the main conversation', () => {
    expect(showsListedShell({ loaded: false })).toBe(true);
  });
  it.each([
    ['once the conversation has loaded', { loaded: true }],
    ['when the load failed', { loaded: false, error: new Error('network unavailable') }],
    ['for a thread', { loaded: false, threadId: 'th_1' }],
    ['for an older page', { before: 42, loaded: false }],
  ])('has no stand-in %s', (_, state) => {
    expect(showsListedShell(state)).toBe(false);
  });
});
