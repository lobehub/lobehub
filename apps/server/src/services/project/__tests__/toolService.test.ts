import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectToolService } from '../toolService';

const state = vi.hoisted(() => ({
  bind: vi.fn(),
  configuration: {} as Record<string, unknown>,
  directories: [] as Record<string, unknown>[],
  online: [] as { deviceId: string; online: boolean }[],
  sandboxOrder: 0,
  stat: undefined as { exists: boolean; isDirectory: boolean } | undefined,
  topic: undefined as Record<string, unknown> | undefined,
  update: vi.fn(),
}));

vi.mock('@/database/models/projectWorkingDirectory', () => ({
  ProjectWorkingDirectoryModel: class {
    list = async () => state.directories;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = async () => state.topic;
  },
}));
vi.mock('@/database/repositories/projectDirectory', () => ({
  ProjectDirectoryRepository: class {
    bind = state.bind;
    executionOrder = async () => ({ sandbox: state.sandboxOrder });
  },
}));
vi.mock('@/database/repositories/projectEnvironment', () => ({
  ProjectEnvironmentRepository: class {
    get = async () => ({ configuration: state.configuration });
    update = state.update;
  },
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    queryDeviceList: async () => state.online,
    statPath: async () => state.stat,
  },
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: async () => [],
}));

const directory = (id: string, sortOrder: number, deviceId = 'dev-1') => ({
  deviceId,
  deviceName: 'Laptop',
  id,
  path: `/work/${id}`,
  platform: 'darwin',
  runnable: true,
  sortOrder,
});

const create = (topicId?: string) =>
  createProjectToolService({} as LobeChatDatabase, {
    projectId: 'project-1',
    topicId,
    userId: 'user-1',
  });

beforeEach(() => {
  state.bind.mockReset();
  state.update.mockReset();
  state.configuration = {};
  state.directories = [];
  state.online = [];
  state.sandboxOrder = 0;
  state.stat = undefined;
  state.topic = undefined;
});

describe('createProjectToolService', () => {
  it('orders runners as the settings list does and marks the conversation runner', async () => {
    state.directories = [directory('dir-a', 2), directory('dir-b', 0, 'dev-2')];
    state.sandboxOrder = 1;
    state.online = [{ deviceId: 'dev-2', online: true }];
    state.topic = { projectId: 'project-1', projectWorkingDirectoryId: 'dir-a' };

    const { runners } = await create('topic-1').listRunners();

    expect(runners.map((runner) => runner.id)).toEqual(['dir-b', 'sandbox', 'dir-a']);
    expect(runners.find((runner) => runner.current)?.id).toBe('dir-a');
    expect(runners[0].online).toBe(true);
    expect(runners[2].online).toBe(false);
  });

  it('marks the sandbox for a project conversation without a folder', async () => {
    state.directories = [directory('dir-a', 0)];
    state.topic = { projectId: 'project-1', projectWorkingDirectoryId: null };

    const { runners } = await create('topic-1').listRunners();

    expect(runners.find((runner) => runner.current)?.id).toBe('sandbox');
  });

  it('refuses a folder the device says does not exist, before binding', async () => {
    state.stat = { exists: false, isDirectory: false };

    await expect(create().addRunner({ deviceId: 'dev-1', path: '/nope' })).rejects.toThrow(
      /does not exist/,
    );
    expect(state.bind).not.toHaveBeenCalled();
  });

  it('keeps variables when editing and refuses a repository host the settings refuse', async () => {
    state.configuration = { env: { REGION: 'us' }, sources: [] };
    state.update.mockImplementation(async (_projectId, { configuration }) => ({ configuration }));

    const environment = await create().updateEnvironment({
      addRepositories: [{ url: 'https://github.com/acme/app' }],
      setupCommand: 'pnpm i',
    });

    expect(state.update.mock.calls[0][1].configuration.env).toEqual({ REGION: 'us' });
    expect(environment).toMatchObject({
      bootstrapCommand: 'pnpm i',
      envNames: ['REGION'],
      repositories: [{ url: 'https://github.com/acme/app' }],
    });

    await expect(
      create().updateEnvironment({ addRepositories: [{ url: 'https://evil.test/x' }] }),
    ).rejects.toThrow(/Invalid environment/);
  });
});
