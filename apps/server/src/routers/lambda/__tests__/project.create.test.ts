// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // Stand-in for the database error the router narrows on; the real class lives
  // in the mocked `@/database/models/project` module.
  class ProjectIdentifierTakenError extends Error {
    readonly identifier: string;

    constructor(identifier: string) {
      super(`Project identifier "${identifier}" is already in use in this scope`);
      this.identifier = identifier;
      this.name = 'ProjectIdentifierTakenError';
    }
  }

  return {
    assertCanPerformResourceAction: vi.fn(),
    create: vi.fn(),
    createDefaultChannel: vi.fn(),
    createSite: vi.fn(),
    ProjectIdentifierTakenError,
    resolveCoordinatorAgents: vi.fn(),
  };
});

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
  ProjectIdentifierTakenError: mocks.ProjectIdentifierTakenError,
  ProjectModel: vi.fn(function () {
    return { create: mocks.create, resolveCoordinatorAgents: mocks.resolveCoordinatorAgents };
  }),
}));

vi.mock('@/database/repositories/project', () => ({
  ProjectRepository: vi.fn(function () {
    return { create: mocks.create };
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

describe('project.create duplicate field codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCoordinatorAgents.mockImplementation(async (projects) => projects);
  });

  it('answers a taken identifier with the identifier code the create forms key off', async () => {
    mocks.create.mockRejectedValue(new mocks.ProjectIdentifierTakenError('LOBE'));

    await expect(
      caller('ws-1').create({ identifier: 'LOBE', name: 'Launch' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_PROJECT_IDENTIFIER' });
    expect(mocks.createDefaultChannel).not.toHaveBeenCalled();
  });

  it('answers a taken slug with the slug code instead of the identifier one', async () => {
    // Drizzle wraps the driver error, so the Postgres fields sit down the chain.
    mocks.create.mockRejectedValue(
      Object.assign(new Error('Failed query: insert into "projects" ...'), {
        cause: { code: '23505', constraint: 'projects_slug_workspace_id_unique' },
      }),
    );

    await expect(caller('ws-1').create({ name: 'Launch' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'DUPLICATE_PROJECT_SLUG',
    });
    expect(mocks.createDefaultChannel).not.toHaveBeenCalled();
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

describe('project.create with ids the create form reserved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      coordinatorAgentId: 'agt_reservedAgnt',
      id: 'prj_reservedProj',
      name: 'Launch',
    });
    mocks.resolveCoordinatorAgents.mockImplementation(async (projects) => projects);
  });

  it('passes the reserved project and agent ids on to the repository', async () => {
    await caller('ws-1').create({
      dedicatedAgentId: 'agt_reservedAgnt',
      id: 'prj_reservedProj',
      name: 'Launch',
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ dedicatedAgentId: 'agt_reservedAgnt', id: 'prj_reservedProj' }),
    );
  });

  it.each([
    { id: 'agt_reservedProj', name: 'Launch' },
    { id: 'prj_short', name: 'Launch' },
    { dedicatedAgentId: 'prj_reservedAgnt', name: 'Launch' },
    { dedicatedAgentId: 'agt_reserved-gnt', name: 'Launch' },
  ])('rejects an id outside the generated shape: %o', async (input) => {
    await expect(caller('ws-1').create(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
