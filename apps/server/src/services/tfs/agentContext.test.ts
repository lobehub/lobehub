// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTfsAgentContext } from './agentContext';

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  agentVisibility: vi.fn(),
  environments: vi.fn(),
  project: vi.fn(),
  status: vi.fn(),
  topic: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentVisibility = mocks.agentVisibility;
  },
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: class {
    findById = mocks.project;
    listEnvironments = mocks.environments;
  },
}));
vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: class {
    findById = mocks.environment;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.topic;
  },
}));
vi.mock('./connection', () => ({
  TfsConnectionService: class {
    status = mocks.status;
  },
}));

const url = 'https://dev.example.com/Collection/Project/_git/Backend';
const repository = {
  configuration: { sources: [{ kind: 'git', ref: 'refs/heads/develop', url }] },
  id: 'env-tfs',
  visibility: 'public',
};
const deps = { db: {} as never, userId: 'user-1', workspaceId: 'ws-1' };

describe('buildTfsAgentContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.project.mockResolvedValue({ id: 'proj-1' });
    mocks.environments.mockResolvedValue([repository]);
    mocks.environment.mockImplementation(async (id: string) =>
      id === repository.id ? repository : undefined,
    );
    mocks.topic.mockResolvedValue({ projectId: 'proj-1', metadata: {} });
    mocks.status.mockResolvedValue({
      configured: true,
      collectionUrl: 'https://dev.example.com/Collection',
      identity: { login: 'user' },
    });
  });

  it('gives old conversations the linked repository without claiming it is checked out', async () => {
    const prompt = await buildTfsAgentContext(deps, { topicId: 'old-topic' });
    expect(prompt).toContain(url);
    expect(prompt).toContain('develop');
    expect(prompt).toContain('env-tfs');
    expect(prompt).toContain('not selected');
    expect(prompt).toContain('not proof');
  });

  it('describes the selected environment and its actual folder separately from linked sources', async () => {
    mocks.topic.mockResolvedValue({
      projectId: 'proj-1',
      metadata: {
        sandboxEnvironmentId: 'env-tfs',
        sandboxDrive: 'personal',
        sandboxWorkingDirectory: 'projects/proj-1/env-tfs',
      },
    });
    const prompt = await buildTfsAgentContext(deps, { topicId: 'topic' });
    expect(prompt).toContain('selected');
    expect(prompt).toContain('projects/proj-1/env-tfs');
    expect(prompt).toContain('personal');
  });

  it('supports a selected TFS environment outside a project', async () => {
    mocks.topic.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-tfs' } });
    expect(await buildTfsAgentContext(deps, { topicId: 'topic' })).toContain(url);
  });

  it('supports project task runs and device runs without a cloud environment', async () => {
    const prompt = await buildTfsAgentContext(deps, { projectId: 'proj-1' });
    expect(prompt).toContain(url);
    expect(prompt).toContain('device');
    expect(prompt).toContain('credential manager');
    expect(prompt).toContain('GitHub');
  });

  it('uses the existing topic project rather than a caller-supplied project', async () => {
    await buildTfsAgentContext(deps, { projectId: 'other-project', topicId: 'topic' });
    expect(mocks.project).toHaveBeenCalledWith('proj-1');
    expect(mocks.project).not.toHaveBeenCalledWith('other-project');
  });

  it('does not disclose projects for an unreadable topic or an unbound existing topic', async () => {
    mocks.topic.mockResolvedValue(undefined);
    expect(
      await buildTfsAgentContext(deps, { projectId: 'proj-1', topicId: 'missing' }),
    ).toBeUndefined();
    mocks.topic.mockResolvedValue({ metadata: {} });
    expect(
      await buildTfsAgentContext(deps, { projectId: 'proj-1', topicId: 'unbound' }),
    ).toBeUndefined();
    expect(mocks.environments).not.toHaveBeenCalled();
  });

  it('never exposes another member private environment or credential-bearing URLs', async () => {
    mocks.environment.mockResolvedValue(undefined);
    expect(await buildTfsAgentContext(deps, { projectId: 'proj-1' })).toBeUndefined();
    mocks.environment.mockResolvedValue({
      ...repository,
      configuration: {
        sources: [
          {
            kind: 'git',
            url: 'https://user:secret@dev.example.com/Collection/Project/_git/Backend',
          },
        ],
      },
    });
    expect(await buildTfsAgentContext(deps, { projectId: 'proj-1' })).toBeUndefined();
  });

  it('does not add any context or read personal TFS identity for GitHub-only projects', async () => {
    mocks.environments.mockResolvedValue([
      {
        ...repository,
        configuration: { sources: [{ kind: 'git', url: 'https://github.com/org/repo' }] },
      },
    ]);
    expect(await buildTfsAgentContext(deps, { projectId: 'proj-1' })).toBeUndefined();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('reports missing personal binding without requesting secrets in chat', async () => {
    mocks.status.mockResolvedValue({ configured: true, identity: null });
    const prompt = await buildTfsAgentContext(deps, { projectId: 'proj-1' });
    expect(prompt).toContain('Settings > Integrations');
    expect(prompt).toContain('Never ask');
    expect(prompt).toContain(url);
  });

  it('isolates context lookup failures', async () => {
    mocks.environments.mockRejectedValue(new Error('database unavailable'));
    expect(await buildTfsAgentContext(deps, { projectId: 'proj-1' })).toBeUndefined();
  });

  it('keeps repository metadata when personal binding status cannot be read', async () => {
    mocks.status.mockRejectedValue(new Error('identity unavailable'));
    const prompt = await buildTfsAgentContext(deps, { projectId: 'proj-1' });
    expect(prompt).toContain(url);
    expect(prompt).toContain('status is unavailable');
  });

  it('never injects owner project metadata into an agent-share visitor topic', async () => {
    mocks.topic.mockResolvedValue({ senderId: 'visitor', projectId: 'proj-1', metadata: {} });
    expect(await buildTfsAgentContext(deps, { topicId: 'visitor-topic' })).toBeUndefined();
    expect(mocks.environments).not.toHaveBeenCalled();
  });

  it('excludes own private sources from shared agents, including explicitly selected environments', async () => {
    mocks.agentVisibility.mockResolvedValue('public');
    mocks.topic.mockResolvedValue({
      agentId: 'shared-agent',
      projectId: 'proj-1',
      metadata: { sandboxEnvironmentId: repository.id },
    });
    mocks.environment.mockResolvedValue({ ...repository, visibility: 'private' });
    expect(await buildTfsAgentContext(deps, { topicId: 'topic' })).toBeUndefined();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('filters private sources for task agents without a topic and keeps published sources', async () => {
    mocks.agentVisibility.mockResolvedValue('public');
    mocks.environment.mockResolvedValue({ ...repository, visibility: 'private' });
    expect(
      await buildTfsAgentContext(deps, { projectId: 'proj-1', agentId: 'shared-agent' }),
    ).toBeUndefined();
    mocks.environment.mockResolvedValue(repository);
    expect(
      await buildTfsAgentContext(deps, { projectId: 'proj-1', agentId: 'shared-agent' }),
    ).toContain(url);
  });

  it('keeps own private sources available to a private agent', async () => {
    mocks.agentVisibility.mockResolvedValue('private');
    mocks.environment.mockResolvedValue({ ...repository, visibility: 'private' });
    expect(
      await buildTfsAgentContext(deps, { projectId: 'proj-1', agentId: 'private-agent' }),
    ).toContain(url);
  });

  it('also enforces the executing agent visibility when it differs from the topic agent', async () => {
    mocks.topic.mockResolvedValue({ agentId: 'private-agent', projectId: 'proj-1', metadata: {} });
    mocks.agentVisibility.mockImplementation(async (id: string) =>
      id === 'shared-agent' ? 'public' : 'private',
    );
    mocks.environment.mockResolvedValue({ ...repository, visibility: 'private' });
    expect(
      await buildTfsAgentContext(deps, { topicId: 'topic', agentId: 'shared-agent' }),
    ).toBeUndefined();
  });

  it('does not leak a filtered selection or its folder when other published sources remain', async () => {
    const privateEnvironment = {
      ...repository,
      id: 'private-environment',
      visibility: 'private',
      configuration: {
        sources: [
          { kind: 'git', url: 'https://dev.example.com/Collection/PrivateProject/_git/Secret' },
        ],
      },
    };
    mocks.environments.mockResolvedValue([repository, privateEnvironment]);
    mocks.environment.mockImplementation(async (id: string) =>
      id === repository.id ? repository : privateEnvironment,
    );
    mocks.agentVisibility.mockResolvedValue('public');
    mocks.topic.mockResolvedValue({
      agentId: 'shared-agent',
      projectId: 'proj-1',
      metadata: {
        sandboxEnvironmentId: privateEnvironment.id,
        sandboxWorkingDirectory: `projects/p/${privateEnvironment.id}`,
      },
    });
    const prompt = await buildTfsAgentContext(deps, { topicId: 'topic' });
    expect(prompt).toContain(url);
    expect(prompt).not.toContain(privateEnvironment.id);
    expect(prompt).not.toContain('PrivateProject');
  });
});
