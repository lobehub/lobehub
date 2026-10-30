// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, userSettings } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import {
  createChannelFixture,
  deviceConfig,
  jobById,
  jobsOf,
  lease,
  operationById,
} from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-config');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel Agent configuration', () => {
  it.each(['codex', 'claude-code'])('preserves the legacy model-only %s runtime', async (model) => {
    const team = await fixture.createTeamChannel();
    const member = await fixture.addAgent(team.channel.id, 'Legacy Agent');
    await db
      .update(agents)
      .set({ model, agencyConfig: null })
      .where(eq(agents.id, member.agentId!));
    const message = await team.asMember.send(team.channel.id, {
      content: 'Request',
      mentions: [member.id],
      requestKey: 'request',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    expect(claim.job.executionConfig?.runtime).toBe(model);
  });

  it.each([false, true])('uses the Agent default layers (workspace=%s)', async (workspace) => {
    await db.insert(userSettings).values({
      id: fixture.ownerId,
      defaultAgent: { config: { model: 'personal-model', provider: 'personal-provider' } },
    });
    const repository = new ChannelRepository(
      db,
      fixture.ownerId,
      workspace ? fixture.workspaceId : undefined,
    );
    const { channel } = await repository.create({ title: 'Defaults' });
    const [agent] = await db
      .insert(agents)
      .values({
        userId: fixture.ownerId,
        workspaceId: workspace ? fixture.workspaceId : null,
        model: '',
        provider: null,
        systemRole: 'Agent instructions',
      })
      .returning();
    const member = await repository.addAgent(channel.id, { agentId: agent.id });
    const message = await repository.send(channel.id, {
      content: 'Request',
      mentions: [member.id],
      requestKey: 'request',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const claim = (await execution.claim(channel.id, job.id, {
      ...lease,
      serverDefaultAgentConfig: {
        model: 'server-model',
        provider: 'server-provider',
        systemRole: 'Server instructions',
      },
    }))!;
    expect(claim.job.executionConfig).toMatchObject({
      model: workspace ? 'server-model' : 'personal-model',
      provider: workspace ? 'server-provider' : 'personal-provider',
      systemRole: 'Agent instructions',
      runtime: 'native',
    });
  });

  it('keeps the Channel environment while ignoring a stale member configuration copy', async () => {
    const team = await fixture.createTeamChannel();
    const member = await fixture.addAgent(
      team.channel.id,
      'Coder',
      deviceConfig('/channel-directory'),
    );
    const oldCopy = {
      ...member.config,
      model: 'stale',
      provider: 'stale',
      runtime: 'native',
      systemRole: 'Stale',
    };
    await db
      .update(channelMembers)
      .set({ config: oldCopy })
      .where(eq(channelMembers.id, member.id));
    await db
      .update(agents)
      .set({
        model: 'current-model',
        provider: 'current-provider',
        systemRole: 'Current',
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
      })
      .where(eq(agents.id, member.agentId!));
    const message = await team.asMember.send(team.channel.id, {
      content: 'Request',
      mentions: [member.id],
      requestKey: 'request',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    expect(claim.job.executionConfig).toMatchObject({
      model: 'current-model',
      provider: 'current-provider',
      systemRole: 'Current',
      runtime: 'claude-code',
      deviceId: 'device-1',
      workingDirectory: '/channel-directory',
    });
    expect(claim.job).toMatchObject({
      deviceId: 'device-1',
      workingDirectory: '/channel-directory',
    });
  });

  it('reads the current Agent at claim time and preserves an earlier execution snapshot', async () => {
    const team = await fixture.createTeamChannel();
    const member = await fixture.addAgent(team.channel.id, 'Agent');
    const send = async (requestKey: string) => {
      const message = await team.asMember.send(team.channel.id, {
        content: requestKey,
        mentions: [member.id],
        requestKey,
        routing: 'fallback',
      });
      return (await jobsOf(db, message.id))[0];
    };
    const first = (await execution.claim(team.channel.id, (await send('first')).id, lease))!;
    const queued = await send('queued before changing settings');
    await db
      .update(agents)
      .set({
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        systemRole: 'Use the updated instructions',
      })
      .where(eq(agents.id, member.agentId!));
    expect((await jobById(db, first.job.id)).executionConfig).toEqual(first.job.executionConfig);
    await execution.accepted(team.channel.id, first.job.id);
    await execution.saveDraft(team.channel.id, first.job.id, 'Done');
    await execution.releaseWriter(team.channel.id, first.job.id);
    const next = (await execution.claim(team.channel.id, queued.id, lease))!;
    expect(next.job.executionConfig).toMatchObject({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      systemRole: 'Use the updated instructions',
    });
    expect(await operationById(db, next.job.operationId)).toMatchObject({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    });
    expect(next.topic.id).not.toBe(first.topic.id);
  });

  it.each(['private', 'trashed', 'other scope'])(
    'blocks a queued request after its Agent becomes %s',
    async (reason) => {
      const team = await fixture.createTeamChannel();
      const member = await fixture.addAgent(team.channel.id, 'Agent');
      const message = await team.asMember.send(team.channel.id, {
        content: 'Request',
        mentions: [member.id],
        requestKey: 'request',
        routing: 'fallback',
      });
      const [job] = await jobsOf(db, message.id);
      await db
        .update(agents)
        .set(
          reason === 'private'
            ? { visibility: 'private' }
            : reason === 'trashed'
              ? { isDeleted: true, deletedAt: new Date() }
              : { workspaceId: null },
        )
        .where(eq(agents.id, member.agentId!));
      expect(await execution.claim(team.channel.id, job.id, lease)).toBeNull();
      expect(await jobById(db, job.id)).toMatchObject({
        blockedCode: 'unavailable',
        operationId: null,
        topicId: null,
      });
    },
  );
});
