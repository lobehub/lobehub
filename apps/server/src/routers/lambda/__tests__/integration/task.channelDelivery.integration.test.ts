// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { ChannelRepository } from '@/database/repositories/channel';
import { agentOperations } from '@/database/schemas';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestAgent, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

/**
 * A task's Channel delivery is checked on every write that can set it: `update` with `config` or
 * `configPatch` like `updateConfig`, and `checkChannelDelivery` before a client writes anything.
 */
describe('Task Router Channel delivery', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let member: string;
  let stranger: string;
  let channelId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    member = await createTestAgent(serverDB, userId);
    stranger = await createTestAgent(serverDB, userId);
    const { channel } = await new ChannelRepository(serverDB, userId).create({
      agentConfig: {},
      agentId: member,
      title: 'Reports',
    });
    channelId = channel.id;
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  const storedConfig = async (id: string) =>
    (await new TaskModel(serverDB, userId).findById(id))?.config as Record<string, unknown>;

  it('refuses a delivery the task Agent cannot post to, through config or configPatch', async () => {
    const created = await caller.create({ assigneeAgentId: stranger, instruction: 'Report' });
    const id = created.data.id;

    await expect(caller.update({ config: { delivery: { channelId } }, id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.update({ configPatch: { delivery: { channelId } }, id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedConfig(id)).not.toHaveProperty('delivery');
  });

  it('stores a checked delivery, judged against the Agent the update assigns', async () => {
    const created = await caller.create({ assigneeAgentId: stranger, instruction: 'Report' });
    const id = created.data.id;

    await caller.update({ assigneeAgentId: member, configPatch: { delivery: { channelId } }, id });
    expect(await storedConfig(id)).toMatchObject({ delivery: { channelId, threadId: null } });
  });

  it('checks a delivery without storing it, resolving {} only from a run of the caller', async () => {
    const created = await caller.create({ assigneeAgentId: member, instruction: 'Report' });
    const id = created.data.id;

    expect(await caller.checkChannelDelivery({ delivery: { channelId }, id })).toEqual({
      delivery: { channelId, threadId: null },
      description: `results post to Channel ${channelId} (main timeline)`,
    });
    expect(await caller.checkChannelDelivery({ delivery: null, id })).toEqual({
      delivery: null,
      description: 'Channel delivery cleared',
    });
    await serverDB.insert(agentOperations).values({ id: 'op_direct', status: 'running', userId });
    await expect(
      caller.checkChannelDelivery({ delivery: {}, id, operationId: 'op_direct' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('not in a Channel'),
    });
    expect(await storedConfig(id)).not.toHaveProperty('delivery');
  });
});
