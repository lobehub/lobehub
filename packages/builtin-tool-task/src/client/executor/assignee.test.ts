import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getActiveWorkspaceSlug: vi.fn(),
  getWorkspaceMembers: vi.fn(),
  updateTask: vi.fn(),
  userState: { user: { fullName: 'Me', id: 'usr_1' } as { fullName?: string; id?: string } },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: mocks.getActiveWorkspaceSlug,
}));

vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  getWorkspaceMembers: mocks.getWorkspaceMembers,
}));

vi.mock('@/store/user', () => ({
  useUserStore: { getState: () => mocks.userState },
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    displayUserName: (s: typeof mocks.userState) => s.user?.fullName ?? '',
    userId: (s: typeof mocks.userState) => s.user?.id,
  },
}));

vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));

vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ createTask: mocks.createTask, updateTask: mocks.updateTask }),
}));

vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));

vi.mock('@/services/task', () => ({ taskService: {} }));

// Keep the role gate deterministic: only 'viewer' is excluded here.
vi.mock('@lobechat/const/rbac', () => ({
  canWorkspaceRoleBeTaskAssignee: (role?: string | null) => !!role && role !== 'viewer',
}));

const { taskExecutor } = await import('./index');

const members = [
  { role: 'owner', user: { fullName: 'Me', username: 'me' }, userId: 'usr_1' },
  {
    role: 'member',
    user: { email: 'alice@lobehub.com', fullName: 'Alice Chen', username: 'alice' },
    userId: 'usr_2',
  },
  { role: 'viewer', user: { fullName: 'Viewer', username: 'v' }, userId: 'usr_3' },
];

describe('TaskExecutor — human assignee (assigneeUserId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceSlug.mockReturnValue('acme');
    mocks.getWorkspaceMembers.mockReturnValue(members);
    mocks.createTask.mockResolvedValue({
      assigneeUserId: 'usr_2',
      id: 'task-1',
      identifier: 'T-1',
      name: 'Review',
      priority: 0,
      status: 'backlog',
    });
    mocks.updateTask.mockResolvedValue(undefined);
  });

  describe('createTask', () => {
    it('assigns the member alongside the defaulted executing agent and labels the result', async () => {
      const result = await taskExecutor.createTask(
        { assigneeUserId: 'usr_2', instruction: 'Review', name: 'Review' },
        { agentId: 'agt-current' } as any,
      );

      expect(result.success).toBe(true);
      // The member is the human owner; the executing agent still defaults to
      // the current agent — the two sides coexist.
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: 'agt-current', assigneeUserId: 'usr_2' }),
      );
      expect(result.content).toContain('Assignee: Alice Chen (usr_2)');
    });

    it('still defaults to the current agent when no member is given', async () => {
      await taskExecutor.createTask({ instruction: 'x', name: 'x' }, {
        agentId: 'agt-current',
      } as any);

      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: 'agt-current', assigneeUserId: undefined }),
      );
    });

    it('accepts an explicit agent and a member in the same call (coexisting assignees)', async () => {
      const result = await taskExecutor.createTask({
        assigneeAgentId: 'agt-1',
        assigneeUserId: 'usr_2',
        instruction: 'x',
        name: 'Both',
      });

      expect(result.success).toBe(true);
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: 'agt-1', assigneeUserId: 'usr_2' }),
      );
    });
  });

  describe('editTask', () => {
    it('setting the member leaves the agent side untouched (assignees coexist)', async () => {
      const result = await taskExecutor.editTask({ assigneeUserId: 'usr_2', identifier: 'T-1' });

      expect(result.success).toBe(true);
      expect(mocks.updateTask).toHaveBeenCalledWith(
        'T-1',
        { assigneeUserId: 'usr_2' },
        { source: 'external' },
      );
      expect(result.content).toContain('assignee member → Alice Chen (usr_2)');
    });

    it('setting the agent leaves the member side untouched (assignees coexist)', async () => {
      await taskExecutor.editTask({ assigneeAgentId: 'agt-new', identifier: 'T-1' });

      expect(mocks.updateTask).toHaveBeenCalledWith(
        'T-1',
        { assigneeAgentId: 'agt-new' },
        { source: 'external' },
      );
    });

    it('accepts an agent and a member in the same call (coexisting assignees)', async () => {
      await taskExecutor.editTask({
        assigneeAgentId: 'agt-new',
        assigneeUserId: 'usr_2',
        identifier: 'T-1',
      });

      expect(mocks.updateTask).toHaveBeenCalledWith(
        'T-1',
        { assigneeAgentId: 'agt-new', assigneeUserId: 'usr_2' },
        { source: 'external' },
      );
    });

    it('clearing the member only touches the member side', async () => {
      const result = await taskExecutor.editTask({ assigneeUserId: null, identifier: 'T-1' });

      expect(mocks.updateTask).toHaveBeenCalledWith(
        'T-1',
        { assigneeUserId: null },
        { source: 'external' },
      );
      expect(result.content).toContain('assignee member cleared');
    });
  });

  describe('listWorkspaceMembers', () => {
    it('lists assignable members with ids, roles and a self marker', async () => {
      const result = await taskExecutor.listWorkspaceMembers();

      expect(result.success).toBe(true);
      expect(result.state).toEqual({ count: 2, success: true, total: 2 });
      expect(result.content).toContain('- Me  @me  role=owner  (you)  id=usr_1');
      expect(result.content).toContain(
        '- Alice Chen  @alice  alice@lobehub.com  role=member  id=usr_2',
      );
      // Viewers cannot own tasks, so they are not offered as candidates.
      expect(result.content).not.toContain('usr_3');
    });

    it('narrows the directory with query and caps it with limit, same contract as the server', async () => {
      const byEmail = await taskExecutor.listWorkspaceMembers({ query: 'ALICE@lobehub.com' });
      expect(byEmail.state).toEqual({
        count: 1,
        query: 'alice@lobehub.com',
        success: true,
        total: 1,
      });
      expect(byEmail.content).toContain('id=usr_2');
      expect(byEmail.content).not.toContain('usr_1');

      const capped = await taskExecutor.listWorkspaceMembers({ limit: 1 });
      expect(capped.state).toEqual({ count: 1, success: true, total: 2 });
      expect(capped.content).toContain('(1 of 2 — pass query to narrow)');

      const none = await taskExecutor.listWorkspaceMembers({ query: 'zed' });
      expect(none.success).toBe(true);
      expect(none.content).toContain('No workspace members match "zed"');
    });

    it('returns only the signed-in user outside a workspace', async () => {
      mocks.getActiveWorkspaceSlug.mockReturnValue(null);

      const result = await taskExecutor.listWorkspaceMembers();

      expect(mocks.getWorkspaceMembers).not.toHaveBeenCalled();
      expect(result.content).toContain('Not in a workspace');
      expect(result.content).toContain('- Me  (you)  id=usr_1');
    });
  });
});
