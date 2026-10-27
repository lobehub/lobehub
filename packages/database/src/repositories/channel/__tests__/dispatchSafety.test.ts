// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentOperationModel } from '../../../models/agentOperation';
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
    await executions.finishDispatch(channel.id, job.id);
    expect(await jobById(db, job.id)).toMatchObject({
      leaseOwner: null,
      publicationRevoked: true,
      writerHeld: true,
    });
    await executions.releaseWriter(channel.id, job.id);
    expect(await jobById(db, job.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
  });
});
