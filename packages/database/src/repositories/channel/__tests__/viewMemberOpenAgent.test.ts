// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents } from '../../../schemas';
import { canViewerOpenAgent } from '../view';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view-open-agent');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const agentMember = async (repo: { detail: (id: string) => Promise<any> }, channelId: string) =>
  (await repo.detail(channelId)).members.find((item: { agentId: string | null }) => item.agentId);

describe('Channel member canOpenAgent', () => {
  it('lets every workspace member open a public workspace Agent', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');

    expect((await agentMember(asOwner, channel.id)).canOpenAgent).toBe(true);
    expect((await agentMember(asMember, channel.id)).canOpenAgent).toBe(true);
  });

  // The Agent is a colleague's private one: they may chat with it here, not open its page.
  it('lets only the creator open a private workspace Agent', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');
    const member = await agentMember(asOwner, channel.id);
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, member.agentId));

    expect((await agentMember(asOwner, channel.id)).canOpenAgent).toBe(true);
    expect((await agentMember(asMember, channel.id)).canOpenAgent).toBe(false);
  });

  it('leaves people without the field', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const people = (await asOwner.detail(channel.id)).members.filter(
      (item) => item.actorType === 'user',
    );

    expect(people.every((item) => item.canOpenAgent === undefined)).toBe(true);
  });
});

describe('canViewerOpenAgent', () => {
  const row = {
    agentDeleted: null,
    agentUserId: 'owner',
    agentVisibility: 'public' as const,
    agentWorkspaceId: 'ws',
  };

  it('refuses an Agent of another workspace', () => {
    expect(canViewerOpenAgent(row, { userId: 'owner', workspaceId: 'other' })).toBe(false);
  });

  it('refuses an Agent in the recycle bin', () => {
    expect(
      canViewerOpenAgent({ ...row, agentDeleted: true }, { userId: 'owner', workspaceId: 'ws' }),
    ).toBe(false);
  });

  it('opens a personal Agent only for its owner in a personal Channel', () => {
    const personal = { ...row, agentWorkspaceId: null };
    expect(canViewerOpenAgent(personal, { userId: 'owner', workspaceId: null })).toBe(true);
    expect(canViewerOpenAgent(personal, { userId: 'visitor', workspaceId: null })).toBe(false);
    expect(canViewerOpenAgent(personal, { userId: 'owner', workspaceId: 'ws' })).toBe(false);
  });
});
