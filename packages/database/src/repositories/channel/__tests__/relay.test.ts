// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, agents, channels, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository, ChannelRepository } from '..';
import { readManifestMessages } from '../manifest';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-relay');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.memberId });
});
afterEach(fixture.cleanup);

const via = { agentId: 'agent-relayer', name: 'Project Agent', operationId: 'op-relay' };

describe('Relaying a request into another Channel', () => {
  it("lists the caller's active Channels with their active Agent members", async () => {
    const team = await fixture.createTeamChannel('Team');
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const other = await fixture.createTeamChannel('Archived');
    await fixture.addAgent(other.channel.id, 'Sleeper');
    await db.update(channels).set({ status: 'archived' }).where(eq(channels.id, other.channel.id));
    // Not a member: never listed, even in the same workspace.
    await new ChannelRepository(db, fixture.ownerId, fixture.workspaceId).create({
      title: 'Owners only',
    });

    const directory = await new ChannelRepository(
      db,
      fixture.memberId,
      fixture.workspaceId,
    ).directory();
    expect(directory).toHaveLength(1);
    expect(directory[0].channel.id).toBe(team.channel.id);
    expect(directory[0].agents).toEqual([
      expect.objectContaining({
        agentId: reviewer.agentId,
        memberId: reviewer.id,
        name: 'Reviewer',
      }),
    ]);
  });

  it('keeps the person as the sender and exposes the relaying Agent to the run it wakes', async () => {
    const team = await fixture.createTeamChannel();
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const request = await team.asMember.send(team.channel.id, {
      content: '@Reviewer please look at T-1',
      mentions: [reviewer.id],
      metadata: { via },
      requestKey: 'agent-relay:op-relay:call-1',
      routing: 'decision',
    });
    expect(request).toMatchObject({
      agentId: null,
      metadata: { via },
      routingStatus: 'directed',
      userId: fixture.memberId,
    });

    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, claim.job.operationId!));

    const [context] = await readManifestMessages(db, team.channel.id, claim.job.manifest!, {
      messageId: request.id,
    });
    expect(context.via).toEqual({ agentId: via.agentId, name: via.name });
    expect(context.author).toMatchObject({ id: fixture.memberId, type: 'user' });

    const run = await new ChannelHistoryRepository(
      db,
      fixture.memberId,
      fixture.workspaceId,
    ).currentRun(claim.job.operationId!);
    expect(run.channelId).toBe(team.channel.id);
    expect(run.manifest.self.agentId).toBe(reviewer.agentId);
    expect(run.requestVia).toEqual({ agentId: via.agentId, name: via.name });

    const view = await team.asOwner.detail(team.channel.id);
    expect(view.messages.find((message) => message.id === request.id)?.via).toEqual({
      agentId: via.agentId,
      // The relaying Agent no longer exists here, so only its recorded name is left.
      avatar: null,
      name: via.name,
    });
  });

  it("shows the answering Agent's avatar on a receipt and hands the run where it came from", async () => {
    const team = await fixture.createTeamChannel();
    const relayer = await fixture.addAgent(team.channel.id, 'Relayer');
    const answerer = await fixture.addAgent(team.channel.id, 'Answerer');
    await db.update(agents).set({ avatar: '🦊' }).where(eq(agents.id, answerer.agentId!));
    const receipt = {
      channelId: 'channel-elsewhere',
      channelTitle: 'Platform',
      messageId: 'reply-1',
    };
    const request = await team.asMember.send(team.channel.id, {
      content: '@Relayer Fixed in the tokenizer',
      mentions: [relayer.id],
      metadata: { receipt, via: { agentId: answerer.agentId, name: 'Answerer' } },
      requestKey: 'relay-receipt:reply-1',
      routing: 'decision',
    });

    const message = (await team.asOwner.detail(team.channel.id)).messages.find(
      (entry) => entry.id === request.id,
    );
    expect(message?.receipt).toEqual(receipt);
    expect(message?.via).toEqual({ agentId: answerer.agentId, avatar: '🦊', name: 'Answerer' });

    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    const [context] = await readManifestMessages(db, team.channel.id, claim.job.manifest!, {
      messageId: request.id,
    });
    expect(context.receipt).toEqual(receipt);
  });

  it('reports no relay for an ordinary request', async () => {
    const team = await fixture.createTeamChannel();
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const request = await team.asMember.send(team.channel.id, {
      content: 'Hi',
      mentions: [reviewer.id],
      requestKey: 'plain',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, claim.job.operationId!));

    const run = await new ChannelHistoryRepository(
      db,
      fixture.memberId,
      fixture.workspaceId,
    ).currentRun(claim.job.operationId!);
    expect(run.requestVia).toBeUndefined();
    const view = await team.asOwner.detail(team.channel.id);
    const plain = view.messages.find((message) => message.id === request.id);
    expect(plain?.via).toBeNull();
    expect(plain?.receipt).toBeNull();
  });
});
