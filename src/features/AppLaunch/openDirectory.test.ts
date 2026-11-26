import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openDirectoryInApp } from './openDirectory';

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  createProject: vi.fn(),
  deviceId: 'device-local' as string | undefined,
  find: vi.fn(),
  inboxAgentId: 'agt_inbox' as string | undefined,
  list: vi.fn(),
  listTopics: vi.fn(),
}));

vi.mock('@/services/project', () => ({ projectService: { find: mocks.find } }));

vi.mock('@/services/projectWorkingDirectory', () => ({
  projectWorkingDirectoryService: { list: mocks.list, listTopics: mocks.listTopics },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: { getState: () => ({ resolveGatewayDeviceId: async () => mocks.deviceId }) },
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

const launch = (reuseExisting = true) => {
  const navigate = vi.fn();
  return {
    navigate,
    result: openDirectoryInApp({ navigate, reuseExisting, targetPath: TARGET }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deviceId = LOCAL;
  mocks.inboxAgentId = 'agt_inbox';
  mocks.list.mockResolvedValue({ data: [] });
  mocks.listTopics.mockResolvedValue({ data: [] });
  mocks.createProject.mockResolvedValue({ coordinatorAgentId: 'agt_inbox', id: 'prj_new' });
  mocks.bind.mockResolvedValue({ id: 'dir_new' });
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

    it('should open a draft in the new directory after one list call', async () => {
      const { navigate, result } = launch();
      await result;

      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/project/prj_new/topic?agent=agt_inbox&dir=dir_new');
    });

    it('should let the server pick the main agent when LobeAI is not loaded yet', async () => {
      mocks.inboxAgentId = undefined;
      mocks.createProject.mockResolvedValue({ coordinatorAgentId: 'agt_server', id: 'prj_new' });

      const { navigate, result } = launch();
      await result;

      expect(mocks.createProject).toHaveBeenCalledWith({
        coordinatorAgentId: undefined,
        name: 'ryugi-cloud',
      });
      expect(navigate).toHaveBeenCalledWith('/project/prj_new/topic?agent=agt_server&dir=dir_new');
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
    await result;

    expect(navigate).toHaveBeenCalledWith('/project/prj_a/topic/tpc_1');
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('should go to the project list without a device identity', async () => {
    mocks.deviceId = undefined;

    const { navigate, result } = launch();
    await result;

    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});
