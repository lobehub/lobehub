import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stopSandboxInstance } from './stopInstance';

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
  findLiveByTopic: vi.fn(),
  findTopic: vi.fn(),
  interrupt: vi.fn(),
  runtimeActors: [] as string[],
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.findTopic;
  },
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findByIds = mocks.findByIds;
    findLiveByTopic = mocks.findLiveByTopic;
  },
}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: class {
    constructor(_db: unknown, userId: string) {
      mocks.runtimeActors.push(userId);
    }
    interruptOperation = mocks.interrupt;
  },
}));

const fixture = () => ({
  client: {
    prepareStop: vi.fn().mockResolvedValue({ prepared: true }),
    readStopTarget: vi.fn().mockResolvedValue({ sessionId: 'session-1', topicId: 'topic-1' }),
    stopInstance: vi.fn().mockResolvedValue({ stopped: true }),
  },
  id: 'instance-1',
  instanceModel: { findOwnedById: vi.fn().mockResolvedValue({ id: 'instance-1' }) },
  serverDB: {} as LobeChatDatabase,
  userId: 'environment-owner',
  workspaceId: 'workspace-1',
});

describe('stopSandboxInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeActors.length = 0;
    mocks.findTopic.mockResolvedValue({
      id: 'topic-1',
      metadata: { runningOperation: { operationId: 'op-1' } },
    });
    mocks.findByIds.mockResolvedValue([
      { id: 'op-1', status: 'running', topicId: 'topic-1', userId: 'running-member' },
    ]);
    mocks.findLiveByTopic.mockImplementation(() => mocks.findByIds());
    mocks.interrupt.mockResolvedValue(true);
  });

  it('retains the live operation and lease when fence preparation fails', async () => {
    const options = fixture();
    options.client.prepareStop.mockRejectedValue(new Error('fence unavailable'));
    await expect(stopSandboxInstance(options)).rejects.toThrow('fence unavailable');
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(options.client.stopInstance).not.toHaveBeenCalled();
  });

  it('persists the operation fence before a parked run can settle, retaining it across retry', async () => {
    const options = fixture();
    const fenced = new Set<string>();
    options.client.prepareStop.mockImplementation(async (params: any) => {
      for (const id of params.operationIds) fenced.add(id);
      return { prepared: true };
    });
    mocks.interrupt.mockImplementation(async (id) => {
      expect(fenced.has(id)).toBe(true);
      mocks.findByIds.mockResolvedValue([]); // waiting_for_client settled synchronously
      return true;
    });
    options.client.stopInstance.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(stopSandboxInstance(options)).rejects.toThrow('provider unavailable');
    await expect(stopSandboxInstance(options)).resolves.toEqual({ stopped: true });
    expect(fenced.has('op-1')).toBe(true);
  });

  it('interrupts a durable live row when the rendering marker is absent', async () => {
    mocks.findTopic.mockResolvedValue({ id: 'topic-1', metadata: {} });
    await stopSandboxInstance(fixture());
    expect(mocks.interrupt).toHaveBeenCalledWith('op-1');
  });

  it.each(['waiting_for_human', 'waiting_for_async_tool', 'waiting_for_client'])(
    'interrupts a parked %s operation',
    async (status) => {
      mocks.findByIds.mockResolvedValue([
        { id: 'op-1', status, topicId: 'topic-1', userId: 'running-member' },
      ]);
      await stopSandboxInstance(fixture());
      expect(mocks.interrupt).toHaveBeenCalledWith('op-1');
    },
  );

  it('interrupts the holding member before releasing the sandbox', async () => {
    const options = fixture();
    let interrupted = false;
    mocks.interrupt.mockImplementation(async () => {
      interrupted = true;
      return true;
    });
    options.client.stopInstance.mockImplementation(async () => {
      expect(interrupted).toBe(true);
      return { stopped: true };
    });
    await expect(stopSandboxInstance(options)).resolves.toEqual({ stopped: true });
    expect(mocks.runtimeActors).toEqual(['running-member']);
    expect(mocks.interrupt).toHaveBeenCalledWith('op-1');
    expect(options.client.stopInstance).toHaveBeenCalledWith({
      expectedSessionId: 'session-1',
      name: 'instance-1',
      operationIds: ['op-1'],
    });
  });

  it('denies a member who does not own the environment before reading the holder', async () => {
    const options = fixture();
    options.instanceModel.findOwnedById.mockResolvedValue(undefined);
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(options.client.readStopTarget).not.toHaveBeenCalled();
    expect(mocks.interrupt).not.toHaveBeenCalled();
  });

  it('does not cancel a topic outside the caller workspace', async () => {
    const options = fixture();
    mocks.findTopic.mockResolvedValue(undefined);
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(options.client.stopInstance).not.toHaveBeenCalled();
  });

  it('does not release the instance when interruption is unconfirmed', async () => {
    const options = fixture();
    mocks.interrupt.mockResolvedValue(false);
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(options.client.stopInstance).not.toHaveBeenCalled();
  });

  it('preserves a replacement holder that arrived during operation lookup', async () => {
    const options = fixture();
    options.client.readStopTarget
      .mockResolvedValueOnce({ sessionId: 'session-1', topicId: 'topic-1' })
      .mockResolvedValue({ sessionId: 'session-2', topicId: 'topic-2' });
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(options.client.stopInstance).not.toHaveBeenCalled();
  });

  it('does not acknowledge a conditional stop that lost its lease', async () => {
    const options = fixture();
    options.client.stopInstance.mockResolvedValue({ stopped: false });
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('stops an idle or management session without inventing an operation', async () => {
    const options = fixture();
    options.client.readStopTarget.mockResolvedValue({ sessionId: 'session-1', topicId: null });
    await expect(stopSandboxInstance(options)).resolves.toEqual({ stopped: true });
    expect(mocks.interrupt).not.toHaveBeenCalled();
  });

  it('fails closed if the running marker refers to another topic', async () => {
    const options = fixture();
    mocks.findByIds.mockResolvedValue([
      { id: 'op-1', status: 'running', topicId: 'other-topic', userId: 'other-user' },
    ]);
    await expect(stopSandboxInstance(options)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(options.client.stopInstance).not.toHaveBeenCalled();
  });
});
