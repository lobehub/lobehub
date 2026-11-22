// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, channelMemberGrants, channelMembers, devices } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { decideDeviceGrant, listDeviceGrants } from '../grants';
import { createChannelFixture, deviceConfig, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-device-grants');
const execution = new ChannelExecutionRepository(db);

beforeEach(async () => {
  await fixture.setup();
  // The member's own workspace device, kept private.
  await db.insert(devices).values({
    deviceId: 'private-1',
    friendlyName: 'Mia MacBook',
    identitySource: 'fallback',
    userId: fixture.memberId,
    visibility: 'private',
    workspaceId: fixture.workspaceId,
  });
});
afterEach(fixture.cleanup);

const grantOf = async (memberId: string) => {
  const [grant] = await db
    .select()
    .from(channelMemberGrants)
    .where(eq(channelMemberGrants.memberId, memberId));
  return grant;
};

const request = async (
  model: ChannelRepository,
  channelId: string,
  agentId: string,
  key: string,
) => {
  const message = await model.send(channelId, {
    content: key,
    mentions: [agentId],
    requestKey: key,
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);
  return job;
};

const blockedCode = async (jobId: string) => {
  const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, jobId));
  return job.blockedCode;
};

describe('channel device grants', () => {
  it('asks the device owner, and runs once they approve', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    const grant = await grantOf(agent.id);
    expect(grant).toMatchObject({ deviceOwnerId: fixture.memberId, status: 'pending' });

    // The owner sees the request, with who asked and where.
    expect(await listDeviceGrants(db, fixture.memberId, fixture.workspaceId)).toMatchObject([
      {
        agentName: 'Coder',
        channelTitle: 'Team',
        deviceName: 'Mia MacBook',
        id: grant.id,
        requesterName: 'Olivia Owner',
        status: 'pending',
        workingDirectory: '/repo',
      },
    ]);
    expect(await listDeviceGrants(db, fixture.ownerId, fixture.workspaceId)).toEqual([]);

    // Every member sees the Agent waits on the owner; the owner is offered the decision.
    const { members } = await asOwner.detail(channel.id);
    expect(members.find((m) => m.id === agent.id)?.environment?.grant).toEqual({
      deviceOwnerId: fixture.memberId,
      id: grant.id,
      status: 'pending',
    });

    const job = await request(asOwner, channel.id, agent.id, 'first');
    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    expect(await blockedCode(job.id)).toBe('device_approval_pending');

    // Only the device owner may decide.
    await expect(decideDeviceGrant(db, fixture.ownerId, grant.id, 'approve')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await decideDeviceGrant(db, fixture.memberId, grant.id, 'approve');
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  it('blocks again once the owner revokes, and refuses a rejected request', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    const grant = await grantOf(agent.id);

    await decideDeviceGrant(db, fixture.memberId, grant.id, 'reject');
    const rejected = await request(asOwner, channel.id, agent.id, 'rejected');
    expect(await execution.claim(channel.id, rejected.id, lease)).toBeNull();
    expect(await blockedCode(rejected.id)).toBe('unavailable');
    // A rejected request drops off the owner's list, and cannot be revoked.
    expect(await listDeviceGrants(db, fixture.memberId, fixture.workspaceId)).toEqual([]);
    await expect(decideDeviceGrant(db, fixture.memberId, grant.id, 'revoke')).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );

    // The owner changes their mind, then takes it back.
    await decideDeviceGrant(db, fixture.memberId, grant.id, 'approve');
    const revoked = await decideDeviceGrant(db, fixture.memberId, grant.id, 'revoke');
    expect(revoked).toMatchObject({ revokeReason: 'revoked_by_owner', status: 'revoked' });
  });

  it('approves at once when the device owner picks their own device', async () => {
    const { channel, member } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    // Environments are an admin's to change.
    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    const asDeviceOwner = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);

    await asDeviceOwner.updateAgentEnvironment(channel.id, agent.id, {
      deviceId: 'private-1',
      deviceOwnerId: fixture.memberId,
      workingDirectory: '/repo',
    });
    expect(await grantOf(agent.id)).toMatchObject({ status: 'approved' });
  });

  it('keeps a decision for the same environment and asks again for a new one', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    const grant = await grantOf(agent.id);
    await decideDeviceGrant(db, fixture.memberId, grant.id, 'approve');

    const environment = {
      deviceId: 'private-1',
      deviceOwnerId: fixture.memberId,
      workingDirectory: '/repo',
    };
    await asOwner.updateAgentEnvironment(channel.id, agent.id, environment);
    expect(await grantOf(agent.id)).toMatchObject({ id: grant.id, status: 'approved' });

    await asOwner.updateAgentEnvironment(channel.id, agent.id, {
      ...environment,
      workingDirectory: '/other',
    });
    expect(await grantOf(agent.id)).toMatchObject({
      status: 'pending',
      workingDirectory: '/other',
    });

    // A stale grant cannot be approved into effect once the Agent moved off the device.
    const stale = await grantOf(agent.id);
    await asOwner.updateAgentEnvironment(channel.id, agent.id, {
      deviceId: 'device-1',
      workingDirectory: '/repo',
    });
    expect(await grantOf(agent.id)).toBeUndefined();
    await expect(
      decideDeviceGrant(db, fixture.memberId, stale.id, 'approve'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never lets the owner approve an environment that changed under the request', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    const pending = await grantOf(agent.id);
    expect(pending).toMatchObject({ status: 'pending', workingDirectory: '/repo' });

    // An admin moves the member to another directory on the same device before the owner answers.
    await asOwner.updateAgentEnvironment(channel.id, agent.id, {
      deviceId: 'private-1',
      deviceOwnerId: fixture.memberId,
      workingDirectory: '/elsewhere',
    });

    const rotated = await grantOf(agent.id);
    expect(rotated).toMatchObject({ status: 'pending', workingDirectory: '/elsewhere' });
    expect(rotated.id).not.toBe(pending.id);

    // The request the owner was looking at cannot be approved into effect for the new directory.
    await expect(
      decideDeviceGrant(db, fixture.memberId, pending.id, 'approve'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Only the environment they are shown now can be decided.
    expect((await decideDeviceGrant(db, fixture.memberId, rotated.id, 'approve')).status).toBe(
      'approved',
    );
  });

  it('asks the owner when a device turns private after it was picked', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await db.update(devices).set({ visibility: 'public' }).where(eq(devices.deviceId, 'private-1'));
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    expect(await grantOf(agent.id)).toBeUndefined();

    await db
      .update(devices)
      .set({ visibility: 'private' })
      .where(eq(devices.deviceId, 'private-1'));
    const job = await request(asOwner, channel.id, agent.id, 'after-private');
    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    expect(await blockedCode(job.id)).toBe('device_approval_pending');
    expect(await grantOf(agent.id)).toMatchObject({
      deviceOwnerId: fixture.memberId,
      status: 'pending',
    });
  });

  it("shows a request card's current status to its device owner only", async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'private-1', fixture.memberId),
    );
    const grant = await grantOf(agent.id);
    const card = await asOwner.postAgentMessage(channel.id, {
      agentId: agent.agentId!,
      content: '[Device request]',
      metadata: {
        deviceGrant: {
          agentName: 'Coder',
          channelId: channel.id,
          channelTitle: 'Team',
          deviceId: 'private-1',
          deviceName: 'Mia MacBook',
          grantId: grant.id,
          requesterName: 'Olivia Owner',
          requesterUserId: fixture.ownerId,
          workingDirectory: '/repo',
        },
      },
      requestKey: `device-grant:${grant.id}`,
    });
    const cardFor = async (model: ChannelRepository) =>
      (await model.detail(channel.id)).messages.find((message) => message.id === card.id)
        ?.deviceGrant;

    expect(await cardFor(asMember)).toMatchObject({
      deviceName: 'Mia MacBook',
      grantId: grant.id,
      status: 'pending',
    });
    // Someone else's request is no card of theirs.
    expect(await cardFor(asOwner)).toBeNull();

    await decideDeviceGrant(db, fixture.memberId, grant.id, 'approve');
    expect(await cardFor(asMember)).toMatchObject({ status: 'approved' });

    // A new environment replaces the grant; the old card no longer decides anything.
    await asOwner.updateAgentEnvironment(channel.id, agent.id, {
      deviceId: 'private-1',
      deviceOwnerId: fixture.memberId,
      workingDirectory: '/other',
    });
    expect(await cardFor(asMember)).toMatchObject({ status: 'expired' });
  });
});
