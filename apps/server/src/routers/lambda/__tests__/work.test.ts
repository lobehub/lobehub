// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the WorkModel mock
// below ignores the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

// RBAC gate → instead of enforcing a real permission, throw a sentinel that
// carries the required permission code. This makes each write procedure's
// declared gate observable end-to-end: whichever code a procedure passes
// through surfaces as `GATE:<code>`, so the test asserts procedure → permission
// mapping rather than just the set of codes requested at module load.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn((code: string) => () => {
    throw new Error(`GATE:${code}`);
  }),
}));

const mockDeleteTaskWork = vi.fn();
const mockRegisterTask = vi.fn();
const mockRegisterDocument = vi.fn();
const mockHandleSkillToolResult = vi.fn();
const mockListByConversation = vi.fn();

vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn(() => ({
    deleteTaskWork: mockDeleteTaskWork,
    handleSkillToolResult: mockHandleSkillToolResult,
    listByConversation: mockListByConversation,
    registerDocument: mockRegisterDocument,
    registerTask: mockRegisterTask,
  })),
}));

// Imported after the mocks above are registered.
const { workRouter } = await import('../work');

const createCaller = () =>
  workRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as any);

describe('workRouter — per-procedure write permission gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registerDocument gates on document:update (aligned with document mutations)', async () => {
    await expect(
      createCaller().registerDocument({
        changeType: 'created',
        documentId: 'doc-1',
        toolIdentifier: 'lobe-agent-documents',
        toolName: 'tool',
      }),
    ).rejects.toThrow('GATE:document:update');
    // The gate short-circuits before the model mutation runs.
    expect(mockRegisterDocument).not.toHaveBeenCalled();
  });

  it('registerTask gates on agent:update (aligned with task mutations)', async () => {
    await expect(
      createCaller().registerTask({
        changeType: 'created',
        toolIdentifier: 'lobe-task',
        toolName: 'tool',
      }),
    ).rejects.toThrow('GATE:agent:update');
    expect(mockRegisterTask).not.toHaveBeenCalled();
  });

  it('deleteTaskWork gates on agent:update (aligned with task mutations)', async () => {
    await expect(createCaller().deleteTaskWork({ taskId: 'task-1' })).rejects.toThrow(
      'GATE:agent:update',
    );
    expect(mockDeleteTaskWork).not.toHaveBeenCalled();
  });

  it('handleSkillToolResult keeps the general agent:update workspace-write gate', async () => {
    await expect(
      createCaller().handleSkillToolResult({ provider: 'linear', toolName: 'createIssue' }),
    ).rejects.toThrow('GATE:agent:update');
    expect(mockHandleSkillToolResult).not.toHaveBeenCalled();
  });

  it('read-only list procedures stay ungated', async () => {
    mockListByConversation.mockResolvedValue([]);
    await expect(createCaller().listByConversation({})).resolves.toEqual([]);
    expect(mockListByConversation).toHaveBeenCalledTimes(1);
  });
});
