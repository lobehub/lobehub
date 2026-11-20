// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResourceConfigAccess: vi.fn(),
  listTopics: vi.fn(),
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
    return { listTopics: mocks.listTopics };
  }),
}));

vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseTopicTargets: vi.fn(),
  assertCanViewTopicTargets: vi.fn(),
}));

vi.mock('../_helpers/resourceConfigGuard', () => ({
  getResourceConfigAccess: mocks.getResourceConfigAccess,
}));

const { projectWorkingDirectoryRouter } = await import('../projectWorkingDirectory');

const caller = (workspaceId: string | null) =>
  projectWorkingDirectoryRouter.createCaller({ userId: 'user-1', workspaceId } as never);

const pinnedRow = (agentId: string) => ({
  agentBoundDeviceId: 'device-mac',
  agentExecutionTargetSelectionPolicy: 'fixed',
  agentId,
  id: `topic-${agentId}`,
});

describe('projectWorkingDirectory.listProjectTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTopics.mockResolvedValue([pinnedRow('agent-editable'), pinnedRow('agent-viewed')]);
    mocks.getResourceConfigAccess.mockImplementation(async (_ctx, _type, agentId: string) =>
      agentId === 'agent-editable' ? 'full' : 'profile',
    );
  });

  /** @example Review: the topic rows leaked a bound device id to view-only workspace members. */
  it('keeps the bound device only for agents the caller may edit', async () => {
    const { data } = await caller('ws-1').listProjectTopics({ projectId: 'prj-1' });

    expect(data).toEqual([
      expect.objectContaining({ agentBoundDeviceId: 'device-mac', agentId: 'agent-editable' }),
      expect.objectContaining({
        agentBoundDeviceId: null,
        agentExecutionTargetSelectionPolicy: 'fixed',
        agentId: 'agent-viewed',
      }),
    ]);
  });

  it('leaves personal projects untouched', async () => {
    const { data } = await caller(null).listProjectTopics({ projectId: 'prj-1' });

    expect(data.map((row) => row.agentBoundDeviceId)).toEqual(['device-mac', 'device-mac']);
    expect(mocks.getResourceConfigAccess).not.toHaveBeenCalled();
  });
});
