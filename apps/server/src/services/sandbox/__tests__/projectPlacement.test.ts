import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentVisibility: vi.fn(),
  getProjectEnvironment: vi.fn(),
}));

vi.mock('@/database/repositories/projectEnvironment', () => ({
  ProjectEnvironmentRepository: vi.fn(function () {
    return { get: mocks.getProjectEnvironment };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentVisibility: mocks.getAgentVisibility };
  }),
}));

const { resolveProjectTopicSandbox } = await import('../projectPlacement');

const db = {} as LobeChatDatabase;
const environment = {
  configuration: {
    kind: 'code',
    sources: [
      { kind: 'git', url: 'https://github.com/lobehub-biz/agent-mail' },
      { kind: 'git', path: 'lobe-tts', url: 'https://github.com/lobehub/lobe-tts' },
    ],
  },
  id: 'env-project',
  name: 'Agent mail',
  visibility: 'private',
};

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveProjectTopicSandbox({ db, projectId: 'proj_1', userId: 'user_1', ...overrides });

describe('resolveProjectTopicSandbox', () => {
  beforeEach(() => {
    mocks.getProjectEnvironment.mockReset().mockResolvedValue(environment);
    mocks.getAgentVisibility.mockReset().mockResolvedValue('private');
  });

  // Coding belongs in the temporary sandbox: the project's environment is
  // applied to a fresh one, never to a folder on the drive.
  it("starts in the project's own environment", async () => {
    await expect(resolve()).resolves.toEqual({ sandboxEnvironmentId: 'env-project' });
    expect(mocks.getProjectEnvironment).toHaveBeenCalledWith('proj_1');
  });

  it('ignores an environment the client names: a project has only its own', async () => {
    await expect(resolve({ environmentId: 'env-other' })).resolves.toEqual({
      sandboxEnvironmentId: 'env-project',
    });
  });

  it('starts nowhere special when the environment checks nothing out', async () => {
    mocks.getProjectEnvironment.mockResolvedValue({
      ...environment,
      configuration: { kind: 'code' },
    });

    await expect(resolve()).resolves.toEqual({});
  });

  it('gives a workspace-public agent the environment only once it is published', async () => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await expect(resolve({ agentId: 'agt_1', workspaceId: 'ws-1' })).resolves.toEqual({});

    mocks.getProjectEnvironment.mockResolvedValue({ ...environment, visibility: 'public' });
    await expect(resolve({ agentId: 'agt_1', workspaceId: 'ws-1' })).resolves.toEqual({
      sandboxEnvironmentId: 'env-project',
    });
  });

  it('never throws', async () => {
    mocks.getProjectEnvironment.mockRejectedValue(new Error('Project not found or access denied'));

    await expect(resolve()).resolves.toEqual({});
  });
});
