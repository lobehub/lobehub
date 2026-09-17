// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mock
// ignores the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockCreate = vi.fn();
const mockFindById = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return {
      create: mockCreate,
      delete: vi.fn(),
      findById: mockFindById,
      query: vi.fn(),
      update: mockUpdate,
    };
  }),
}));

const mockCopyEnvironment = vi.fn();

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {
      getSandboxWorkspaceClient: () => ({ copyEnvironment: mockCopyEnvironment }),
    };
  }),
}));

const mockResolveClaim = vi.fn();

vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxWorkspaceClaim: mockResolveClaim,
}));

const { sandboxWorkspaceRouter } = await import('../sandboxWorkspace');

/** Shaped like the driver error drizzle surfaces, nested behind `cause`. */
const uniqueViolation = (constraint: string) => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as any).cause = { code: '23505', constraint };
  return error;
};

const environmentId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('sandboxWorkspaceRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveClaim.mockResolvedValue({ key: 'ws-org-1', quotaBytes: 1024 });
  });

  describe('entitlement', () => {
    it('refuses every environment call without a workspace claim', async () => {
      // The execution plane would reject these anyway. Failing here keeps a
      // client that renders the panel too eagerly from looking like a server
      // fault, and keeps an unentitled caller from reaching the market at all.
      mockResolveClaim.mockResolvedValue(null);
      const caller = sandboxWorkspaceRouter.createCaller(ctx);

      await expect(caller.createEnvironment({ name: 'Data analysis' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('environment names', () => {
    it.each(['environments_user_name_unique', 'environments_workspace_user_name_unique'])(
      'maps a collision on %s to CONFLICT',
      async (constraint) => {
        mockCreate.mockRejectedValue(uniqueViolation(constraint));
        const caller = sandboxWorkspaceRouter.createCaller(ctx);

        await expect(caller.createEnvironment({ name: 'Data analysis' })).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'DUPLICATE_ENVIRONMENT_NAME',
        });
      },
    );

    it('maps a collision on rename to CONFLICT', async () => {
      mockUpdate.mockRejectedValue(uniqueViolation('environments_user_name_unique'));
      const caller = sandboxWorkspaceRouter.createCaller(ctx);

      await expect(
        caller.renameEnvironment({ id: environmentId, name: 'Data analysis' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_ENVIRONMENT_NAME' });
    });

    it('leaves unrelated failures untouched', async () => {
      mockCreate.mockRejectedValue(uniqueViolation('some_other_unique_index'));
      const caller = sandboxWorkspaceRouter.createCaller(ctx);

      await expect(caller.createEnvironment({ name: 'Data analysis' })).rejects.not.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('copyEnvironment', () => {
    it('carries the specification onto the copy, not just the snapshot', async () => {
      // The snapshot is a cache of the specification. A copy that took the
      // cache without the recipe would rebuild into something else entirely
      // the first time that cache was dropped.
      const configuration = { sources: [{ kind: 'git', url: 'https://example.com/repo.git' }] };
      mockFindById.mockResolvedValue({
        configuration,
        description: 'Original',
        id: environmentId,
        name: 'Data analysis',
      });
      mockCreate.mockResolvedValue({ id: 'copy-id' });
      mockCopyEnvironment.mockResolvedValue(undefined);

      await sandboxWorkspaceRouter
        .createCaller(ctx)
        .copyEnvironment({ id: environmentId, name: 'Data analysis (copy)' });

      expect(mockCreate).toHaveBeenCalledWith({
        configuration,
        description: 'Original',
        name: 'Data analysis (copy)',
      });
      expect(mockCopyEnvironment).toHaveBeenCalledWith({ from: environmentId, to: 'copy-id' });
    });
  });
});
