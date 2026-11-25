import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openDirectoryInApp } from './openDirectory';

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  createProject: vi.fn(),
  find: vi.fn(),
  inboxAgentId: 'agt_inbox' as string | undefined,
  list: vi.fn(),
  listTopics: vi.fn(),
}));

vi.mock('@/services/project', () => ({ projectService: { find: mocks.find } }));

vi.mock('@/services/projectWorkingDirectory', () => ({
  projectWorkingDirectoryService: { list: mocks.list, listTopics: mocks.listTopics },
}));

vi.mock('@/store/project', () => ({
  useProjectStore: { getState: () => ({ createProject: mocks.createProject }) },
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: { getState: () => ({ bind: mocks.bind }) },
}));

vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => ({}) } }));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: () => mocks.inboxAgentId },
}));

const LOCAL = 'device-local';
const TARGET = '/Users/me/code/ryugi-cloud';

const launch = (overrides: Partial<Parameters<typeof openDirectoryInApp>[0]> = {}) => {
  const navigate = vi.fn();
  const result = openDirectoryInApp({
    getDeviceId: () => LOCAL,
    navigate,
    targetPath: TARGET,
    ...overrides,
  });
  return { navigate, result };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inboxAgentId = 'agt_inbox';
  mocks.list.mockResolvedValue({ data: [] });
  mocks.listTopics.mockResolvedValue({ data: [] });
  mocks.createProject.mockResolvedValue({
    coordinatorAgentId: 'agt_inbox',
    id: 'prj_new',
    name: 'ryugi-cloud',
  });
  mocks.bind.mockResolvedValue({ id: 'dir_new', skippedTopics: [] });
});

describe('openDirectoryInApp', () => {
  describe('an unbound directory', () => {
    it('should create a project named after the folder led by LobeAI', async () => {
      await launch().result;

      expect(mocks.createProject).toHaveBeenCalledWith({
        coordinatorAgentId: 'agt_inbox',
        name: 'ryugi-cloud',
      });
    });

    it('should bind the folder on this device to the new project', async () => {
      await launch().result;

      expect(mocks.bind).toHaveBeenCalledWith({
        deviceId: LOCAL,
        name: 'ryugi-cloud',
        path: TARGET,
        projectId: 'prj_new',
      });
    });

    it('should open a draft in the new directory', async () => {
      const { navigate, result } = launch();

      await expect(result).resolves.toMatchObject({ status: 'created-project' });
      expect(navigate).toHaveBeenCalledWith('/project/prj_new/topic?agent=agt_inbox&dir=dir_new');
    });

    it('should not wait for a deadline once the list has answered', async () => {
      vi.useFakeTimers();
      try {
        const { navigate, result } = launch();
        await vi.advanceTimersByTimeAsync(0);
        await result;
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(mocks.list).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should let the server create a main agent when LobeAI is not known yet', async () => {
      mocks.inboxAgentId = undefined;

      await launch().result;

      expect(mocks.createProject).toHaveBeenCalledWith({ name: 'ryugi-cloud' });
    });

    it('should open the new project when binding the folder fails', async () => {
      mocks.bind.mockRejectedValue(new Error('PRECONDITION_FAILED'));

      const { navigate, result } = launch();

      await expect(result).resolves.toMatchObject({ status: 'created-project-unbound' });
      expect(navigate).toHaveBeenCalledWith('/project/prj_new');
    });
  });

  it('should reuse the latest conversation of a bound directory without creating', async () => {
    mocks.list.mockResolvedValue({
      data: [{ deviceId: LOCAL, id: 'dir_a', path: TARGET, projectId: 'prj_a' }],
    });
    mocks.listTopics.mockResolvedValue({
      data: [{ id: 'tpc_1', updatedAt: '2026-11-01T00:00:00Z' }],
    });

    const { navigate, result } = launch();

    await expect(result).resolves.toMatchObject({ status: 'opened-topic' });
    expect(navigate).toHaveBeenCalledWith('/project/prj_a/topic/tpc_1');
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('should fall back to the project list without a device identity', async () => {
    const { navigate, result } = launch({ getDeviceId: () => undefined, timeoutMs: 5 });

    await expect(result).resolves.toMatchObject({ status: 'directory-unavailable' });
    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});
