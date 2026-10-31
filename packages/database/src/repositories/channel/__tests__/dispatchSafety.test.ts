// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentOperationModel } from '../../../models/agentOperation';
import { channelJobs } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import {
  createChannelFixture,
  deviceConfig,
  jobById,
  jobsOf,
  lease,
  operationById,
} from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-dispatch-safety');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const reserve = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Researcher');
  const message = await team.asOwner.send(team.channel.id, {
    content: 'Research',
    requestKey: 'one',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, message.id);
  const claim = await executions.claim(team.channel.id, job.id, lease);
  const operationId = claim!.job.operationId!;
  const model = new AgentOperationModel(db, fixture.ownerId, fixture.workspaceId);
  const start = () =>
    model.recordStart({
      agentId: agent.agentId,
      operationId,
      requireReservation: true,
      topicId: claim!.topic.id,
    });
  return { ...team, job, model, operationId, start };
};

describe('Channel dispatch reservation', () => {
  it('keeps an offline device queued without reserving an operation, then claims on reconnect', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Device agent', deviceConfig());
    const message = await asOwner.send(channel.id, {
      content: 'Wait for device',
      requestKey: 'offline',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    expect(
      await executions.claim(channel.id, job.id, { ...lease, onlineDeviceIds: [] }),
    ).toBeNull();
    expect(await jobById(db, job.id)).toMatchObject({
      status: 'queued',
      operationId: null,
      blockedCode: 'device_offline',
      writerHeld: false,
    });
    const claimed = await executions.claim(channel.id, job.id, {
      ...lease,
      onlineDeviceIds: ['device-1'],
    });
    expect(claimed?.job.operationId).toBeTruthy();
    expect(claimed?.job.blockedCode).toBeNull();
  });
  it('fences a dispatcher that resumes after its reservation was retired', async () => {
    const { channel, job, operationId, start } = await reserve();
    expect(await executions.retireReservation(channel.id, job.id)).toBe(true);
    await expect(start()).rejects.toThrow('reservation');
    expect(await jobById(db, job.id)).toMatchObject({ status: 'failed', writerHeld: false });
    expect(await operationById(db, operationId)).toMatchObject({ status: 'error' });
  });

  it('cannot retire a reservation that the runtime already consumed', async () => {
    const { channel, job, start } = await reserve();
    await start();
    expect(await executions.retireReservation(channel.id, job.id)).toBe(false);
    await expect(start()).rejects.toThrow('reservation');
    expect(await jobById(db, job.id)).toMatchObject({ status: 'running', writerHeld: true });
  });

  it('does not create a new operation when a required reservation is missing', async () => {
    const { model } = await reserve();
    await expect(
      model.recordStart({ operationId: 'never-reserved', requireReservation: true }),
    ).rejects.toThrow('reservation');
    expect(await model.findById('never-reserved')).toBeNull();
  });

  it('keeps a stopped writer held until dispatch settles and physical exit is confirmed', async () => {
    const { asOwner, channel, job, start } = await reserve();
    await start();
    await asOwner.stop(channel.id, { jobId: job.id });
    expect(await jobById(db, job.id)).toMatchObject({
      leaseOwner: 'worker-1',
      publicationRevoked: true,
      writerHeld: true,
    });
    await executions.finishDispatch(channel.id, job.id, lease.leaseOwner);
    expect(await jobById(db, job.id)).toMatchObject({
      leaseOwner: null,
      publicationRevoked: true,
      writerHeld: true,
    });
    await executions.releaseWriter(channel.id, job.id);
    expect(await jobById(db, job.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
  });

  it('keeps a live lease and marks an expired one revoked without releasing the writer', async () => {
    const { channel, job, start } = await reserve();
    await start();
    expect(await executions.revokeExpiredLease(channel.id, job.id)).toBe('live');
    expect(await jobById(db, job.id)).toMatchObject({ leaseOwner: 'worker-1' });

    await db
      .update(channelJobs)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(channelJobs.id, job.id));
    expect(await executions.revokeExpiredLease(channel.id, job.id)).toBe('revoked');
    expect(await jobById(db, job.id)).toMatchObject({
      leaseExpiresAt: null,
      leaseOwner: 'revoked:worker-1',
      status: 'running',
      writerHeld: true,
    });
    // The fenced dispatcher can neither renew nor settle the lease it lost, and later passes
    // still see that its dispatch never settled.
    expect(await executions.heartbeat(job.id, lease)).toBe(false);
    await executions.finishDispatch(channel.id, job.id, lease.leaseOwner);
    expect(await executions.revokeExpiredLease(channel.id, job.id)).toBe('revoked');

    await executions.releaseWriter(channel.id, job.id);
    expect(await jobById(db, job.id)).toMatchObject({ leaseOwner: null, writerHeld: false });
  });

  it('reports a dispatch that settled normally', async () => {
    const { channel, job, start } = await reserve();
    await start();
    await executions.finishDispatch(channel.id, job.id, lease.leaseOwner);
    expect(await executions.revokeExpiredLease(channel.id, job.id)).toBe('settled');
  });

  it('ignores a settle from a dispatcher that no longer owns the lease', async () => {
    const { channel, job } = await reserve();
    await executions.finishDispatch(channel.id, job.id, 'stale-worker');
    expect(await jobById(db, job.id)).toMatchObject({ leaseOwner: 'worker-1' });
  });

  it('offers every member queue head even behind a long blocked backlog', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const offline = await fixture.addAgent(channel.id, 'Offline', deviceConfig());
    const healthy = await fixture.addAgent(channel.id, 'Healthy');
    const blocked = await asOwner.send(channel.id, {
      content: 'Waits for a device',
      mentions: [offline.id],
      requestKey: 'blocked',
      routing: 'decision',
    });
    const [first] = await jobsOf(db, blocked.id);
    for (let index = 0; index < 120; index++) {
      await asOwner.send(channel.id, {
        content: `Backlog ${index}`,
        mentions: [offline.id],
        requestKey: `backlog-${index}`,
        routing: 'decision',
      });
    }
    const fresh = await asOwner.send(channel.id, {
      content: 'Answer me',
      mentions: [healthy.id],
      requestKey: 'fresh',
      routing: 'decision',
    });
    const [freshJob] = await jobsOf(db, fresh.id);

    const { heads } = await executions.candidates(channel.id);
    expect(heads.map((job) => job.id)).toEqual([first.id, freshJob.id]);
  });
});
