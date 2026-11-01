// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTopic: vi.fn(),
  findById: vi.fn(),
  findManageableById: vi.fn(),
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
    return { findById: mocks.findById, findManageableById: mocks.findManageableById };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { create: mocks.createTopic };
  }),
}));

vi.mock('@/server/services/aiAgent/pipeline/precreatedTopic', () => ({
  createAgentConfigResolver: vi.fn(),
  resolvePrecreatedTopicSnapshot: vi.fn(async () => ({ snapshot: { model: 'gpt' } })),
}));

vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseTopicTargets: vi.fn(),
  assertCanViewTopicTargets: vi.fn(),
}));

const { projectWorkingDirectoryRouter } = await import('../projectWorkingDirectory');

const caller = () =>
  projectWorkingDirectoryRouter.createCaller({ userId: 'member', workspaceId: 'ws-1' } as never);
const input = { agentId: 'coordinator', projectId: 'project-1', title: 'Plan the launch' };

describe('projectWorkingDirectory.createProjectTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTopic.mockImplementation(async (value) => ({ id: 'topic-1', ...value }));
  });

  it('lets a workspace member who can read the project start a conversation in it', async () => {
    mocks.findById.mockResolvedValue({ id: 'project-1', userId: 'creator' });
    mocks.findManageableById.mockResolvedValue(null);

    const result = await caller().createProjectTopic(input);

    expect(result.data).toEqual(
      expect.objectContaining({ agentId: 'coordinator', projectId: 'project-1' }),
    );
  });

  it('rejects a project the caller cannot read', async () => {
    mocks.findById.mockResolvedValue(null);

    await expect(caller().createProjectTopic(input)).rejects.toThrow(
      'Project not found or access denied',
    );
    expect(mocks.createTopic).not.toHaveBeenCalled();
  });
});
