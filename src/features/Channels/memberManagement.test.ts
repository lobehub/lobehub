import { describe, expect, it } from 'vitest';

import { canLeaveChannel, canRemoveMember } from './memberManagement';

const group = {
  agentId: null,
  canDelete: true,
  joined: true,
  memberRole: 'admin' as const,
  peerUserId: null,
  status: 'active' as const,
};
const agent = { role: null, status: 'active' as const };

describe('canRemoveMember', () => {
  it('lets an admin remove an Agent or a member of a group Channel', () => {
    expect(canRemoveMember(group, agent, { isSelf: false, selfRole: 'admin' })).toBe(true);
    expect(
      canRemoveMember(
        group,
        { role: 'member', status: 'active' },
        { isSelf: false, selfRole: 'admin' },
      ),
    ).toBe(true);
  });

  it('never removes the owner, the caller, or someone already gone', () => {
    const options = { isSelf: false, selfRole: 'owner' as const };
    expect(canRemoveMember(group, { role: 'owner', status: 'active' }, options)).toBe(false);
    expect(canRemoveMember(group, { role: 'member', status: 'left' }, options)).toBe(false);
    expect(
      canRemoveMember(group, { role: 'member', status: 'active' }, { ...options, isSelf: true }),
    ).toBe(false);
  });

  it('leaves another admin to the owner', () => {
    const admin = { role: 'admin' as const, status: 'active' as const };
    expect(canRemoveMember(group, admin, { isSelf: false, selfRole: 'admin' })).toBe(false);
    expect(canRemoveMember(group, admin, { isSelf: false, selfRole: 'owner' })).toBe(true);
  });

  it('keeps direct conversations and non-admins out', () => {
    const options = { isSelf: false, selfRole: 'admin' as const };
    expect(canRemoveMember({ ...group, agentId: 'agt_1' }, agent, options)).toBe(false);
    expect(canRemoveMember({ ...group, peerUserId: 'user_2' }, agent, options)).toBe(false);
    expect(canRemoveMember({ ...group, canDelete: false }, agent, options)).toBe(false);
  });
});

describe('canLeaveChannel', () => {
  it('lets anyone but the owner leave a group Channel they joined', () => {
    expect(canLeaveChannel(group)).toBe(true);
    expect(canLeaveChannel({ ...group, memberRole: 'member', status: 'archived' })).toBe(true);
    expect(canLeaveChannel({ ...group, memberRole: 'owner' })).toBe(false);
    expect(canLeaveChannel({ ...group, joined: false, memberRole: null })).toBe(false);
    expect(canLeaveChannel({ ...group, agentId: 'agt_1' })).toBe(false);
  });
});
