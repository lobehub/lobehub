// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockFindOwnedById = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return {
      create: mockCreate,
      delete: mockDelete,
      findOwnedById: mockFindOwnedById,
      query: vi.fn(async () => []),
      setVisibility: vi.fn(),
      update: mockUpdate,
    };
  }),
}));

const mockListRepositoryBranches = vi.fn();

vi.mock('@/server/services/connectorData', () => ({
  ConnectorDataService: vi.fn(function () {
    return {
      getGitHubClient: async () => ({ listRepositoryBranches: mockListRepositoryBranches }),
    };
  }),
}));

// The definitions need no drive: if this router ever asked for the claim, the
// throw would fail every test below.
vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxStorageClaim: vi.fn(() => {
    throw new Error('environment definitions must not ask for a drive');
  }),
}));

const { environmentRouter } = await import('../environment');
const { ConnectorDataError } = await import('@lobechat/connector-data');

/** Shaped like the driver error drizzle surfaces, nested behind `cause`. */
const driverError = (code: string, constraint?: string) => {
  const error = new Error('constraint violated');
  (error as any).cause = { code, constraint };
  return error;
};

const environmentId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('environmentRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };
  const caller = () => environmentRouter.createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('environment kind', () => {
    // Stored with the rest of the definition, in the same jsonb column, so the
    // parse must keep it rather than strip it as an unknown key. Only `code`:
    // a folder of files is a folder on the drive, not an environment.
    it('stores a code environment and refuses any other kind', async () => {
      mockCreate.mockResolvedValue({ id: 'env-code', name: 'Atlas' });

      await caller().createEnvironment({ configuration: { kind: 'code' }, name: 'Atlas' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ configuration: { kind: 'code' } }),
      );

      for (const kind of ['files', 'cluster']) {
        mockCreate.mockClear();
        await expect(
          caller().createEnvironment({ configuration: { kind: kind as never }, name: 'Refused' }),
        ).rejects.toThrow();
        expect(mockCreate).not.toHaveBeenCalled();
      }
    });

    it('creates the definition alone, with no folder on any drive', async () => {
      mockCreate.mockResolvedValue({ id: 'env-code', name: 'Atlas' });

      await expect(caller().createEnvironment({ name: 'Atlas' })).resolves.toEqual({
        id: 'env-code',
        name: 'Atlas',
      });
    });
  });

  describe('environment source urls', () => {
    it('stores a github checkout and refuses any other host', async () => {
      // The picker only ever produces a github.com URL, but this is an RPC: a
      // caller reaching it directly could otherwise name an internal address
      // and have a build make the execution plane fetch it.
      mockCreate.mockResolvedValue({ id: 'env-allowed', name: 'Allowed' });

      await caller().createEnvironment({
        configuration: { sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub' }] },
        name: 'Allowed',
      });
      expect(mockCreate).toHaveBeenCalled();

      for (const url of [
        'https://169.254.169.254/latest/meta-data',
        'https://internal.corp/repo.git',
        'https://github.com.attacker.test/a/b',
        'http://github.com/a/b',
      ]) {
        mockCreate.mockClear();
        await expect(
          caller().createEnvironment({
            configuration: { sources: [{ kind: 'git', url }] },
            name: 'Refused',
          }),
        ).rejects.toThrow();
        expect(mockCreate).not.toHaveBeenCalled();
      }
    });
  });

  describe('environment names', () => {
    it.each(['environments_user_name_unique', 'environments_workspace_user_name_unique'])(
      'maps a collision on %s to CONFLICT',
      async (constraint) => {
        mockCreate.mockRejectedValue(driverError('23505', constraint));

        await expect(caller().createEnvironment({ name: 'Data analysis' })).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'DUPLICATE_ENVIRONMENT_NAME',
        });
      },
    );

    it('maps a collision on rename to CONFLICT', async () => {
      mockUpdate.mockRejectedValue(driverError('23505', 'environments_user_name_unique'));

      await expect(
        caller().updateEnvironment({ id: environmentId, name: 'Data analysis' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_ENVIRONMENT_NAME' });
    });

    it('leaves unrelated failures untouched', async () => {
      mockCreate.mockRejectedValue(driverError('23505', 'some_other_unique_index'));

      await expect(caller().createEnvironment({ name: 'Data analysis' })).rejects.not.toMatchObject(
        { code: 'CONFLICT' },
      );
    });
  });

  describe('removeEnvironment', () => {
    it('refuses while a folder is still initialized from it', async () => {
      mockFindOwnedById.mockResolvedValue({ id: environmentId });
      mockDelete.mockRejectedValue(driverError('23503'));

      await expect(caller().removeEnvironment({ id: environmentId })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'ENVIRONMENT_HAS_INSTANCES',
      });
    });

    it('refuses an environment the caller does not own', async () => {
      mockFindOwnedById.mockResolvedValue(undefined);

      await expect(caller().removeEnvironment({ id: environmentId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('listGithubBranches', () => {
    it('lists the branches of one repository through the connected GitHub account', async () => {
      mockListRepositoryBranches.mockResolvedValue(['canary', 'main']);

      const result = await caller().listGithubBranches({ owner: 'lobehub', repository: 'lobehub' });

      expect(result).toEqual({ branches: ['canary', 'main'], connected: true, truncated: false });
      expect(mockListRepositoryBranches).toHaveBeenCalledWith('lobehub', 'lobehub');
    });

    // At the ceiling the list may be partial; the picker falls back to typing
    // so a branch past it can still be entered.
    it('says when the list reached the ceiling and may be partial', async () => {
      mockListRepositoryBranches.mockResolvedValue(
        Array.from({ length: 1000 }, (_, index) => `branch-${index}`),
      );

      const result = await caller().listGithubBranches({ owner: 'lobehub', repository: 'lobehub' });

      expect(result.truncated).toBe(true);
    });

    it('answers not connected rather than failing when GitHub is unavailable', async () => {
      mockListRepositoryBranches.mockRejectedValue(
        new ConnectorDataError({
          code: 'not_connected',
          message: 'no token',
          operation: 'listRepositoryBranches',
          provider: 'github',
          retryable: false,
        }),
      );

      const result = await caller().listGithubBranches({ owner: 'lobehub', repository: 'lobehub' });

      expect(result).toEqual({ branches: [], connected: false, truncated: false });
    });
  });
});
