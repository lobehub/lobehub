// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanPerformResourceAction: vi.fn(),
  create: vi.fn(),
  createDefaultChannel: vi.fn(),
  createSite: vi.fn(),
  resolveCoordinatorAgents: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return { create: mocks.create, resolveCoordinatorAgents: mocks.resolveCoordinatorAgents };
  }),
}));

vi.mock('@/database/repositories/projectCoordinator', () => ({
  ProjectCoordinatorRepository: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/channel/defaultChannel', () => ({
  createDefaultChannel: mocks.createDefaultChannel,
}));

vi.mock('@/server/services/projectReview', () => ({
  ProjectReviewService: vi.fn(function () {
    return { createSite: mocks.createSite };
  }),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
}));

const { projectRouter } = await import('../project');

const caller = (workspaceId?: string) =>
  projectRouter.createCaller({ userId: 'member', workspaceId } as never);

describe('project.create with a picked main agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      coordinatorAgentId: 'agent-1',
      id: 'project-1',
      name: 'Launch',
    });
    mocks.resolveCoordinatorAgents.mockImplementation(async (projects) => projects);
  });

  it('requires `use` access to the agent in a workspace', async () => {
    await caller('ws-1').create({ coordinatorAgentId: 'agent-1', name: 'Launch' });

    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'use',
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'member',
        workspaceId: 'ws-1',
      }),
    );
    expect(mocks.create).toHaveBeenCalled();
  });

  it('refuses an agent the member cannot use and creates nothing', async () => {
    mocks.assertCanPerformResourceAction.mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN', message: 'no use access' }),
    );

    await expect(
      caller('ws-1').create({ coordinatorAgentId: 'agent-1', name: 'Launch' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('skips the check in personal mode and when no agent is picked', async () => {
    await caller().create({ coordinatorAgentId: 'agent-1', name: 'Solo' });
    await caller('ws-1').create({ name: 'Default lead' });

    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
  });
});

describe('project.create default Channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ coordinatorAgentId: null, id: 'project-1', name: 'Launch' });
    mocks.resolveCoordinatorAgents.mockImplementation(async (projects) =>
      projects.map((project: object) => ({ ...project, coordinatorAgentId: 'inbox' })),
    );
  });

  it('opens the project Channel with its resolved main agent in the caller scope', async () => {
    const result = await caller('ws-1').create({ name: 'Launch' });

    expect(mocks.createDefaultChannel).toHaveBeenCalledWith({
      agentId: 'inbox',
      db: {},
      projectId: 'project-1',
      userId: 'member',
      workspaceId: 'ws-1',
    });
    expect(result.data).toMatchObject({ coordinatorAgentId: 'inbox', id: 'project-1' });
  });

  it('opens a personal project Channel outside any workspace', async () => {
    await caller().create({ name: 'Launch' });

    expect(mocks.createDefaultChannel).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', workspaceId: undefined }),
    );
  });
});

describe('project.create from a client that still sends a type or a site', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      coordinatorAgentId: 'agent-1',
      id: 'project-1',
      name: 'Launch',
    });
    mocks.resolveCoordinatorAgents.mockImplementation(async (projects) => projects);
  });

  it('creates only the project and drops the extra fields', async () => {
    const result = await caller('ws-1').create({
      name: 'Launch',
      siteOrigin: 'https://launch.dev',
      type: 'web',
    } as never);

    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('type');
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('siteOrigin');
    expect(mocks.createSite).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('siteError');
  });
});
