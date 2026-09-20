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
// Separate from `findById` on purpose: the two answer different questions now,
// and a test that stubs the readable lookup must not accidentally satisfy a
// path that is supposed to demand ownership.
const mockFindOwnedById = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return {
      create: mockCreate,
      delete: vi.fn(),
      findById: mockFindById,
      findOwnedById: mockFindOwnedById,
      query: vi.fn(),
      setVisibility: vi.fn(),
      update: mockUpdate,
    };
  }),
}));

const mockInstanceCreate = vi.fn();
const mockInstanceDelete = vi.fn();
const mockInstanceFindById = vi.fn();
const mockInstanceFindOwnedById = vi.fn();

vi.mock('@/database/models/environmentInstance', () => ({
  EnvironmentInstanceModel: vi.fn(function () {
    return {
      create: mockInstanceCreate,
      delete: mockInstanceDelete,
      findById: mockInstanceFindById,
      findOwnedById: mockInstanceFindOwnedById,
      findByWorkingDirectory: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    };
  }),
}));

const mockCopyEnvironment = vi.fn();
const mockDeleteEnvironment = vi.fn();

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {
      getSandboxWorkspaceClient: () => ({
        copyEnvironment: mockCopyEnvironment,
        deleteEnvironment: mockDeleteEnvironment,
      }),
    };
  }),
}));

const mockResolveClaim = vi.fn();

vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxWorkspaceClaim: mockResolveClaim,
}));

const { sandboxWorkspaceRouter } = await import('../sandboxWorkspace');
const { SandboxWorkspaceFilesError } = await import('@/server/services/sandbox/workspaceFiles');

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

  describe('createInstance', () => {
    it("binds the instance to the caller's own workspace", async () => {
      // The binding is what `environment_instances_provider_path_unique` keys
      // on, so it has to name the caller's storage rather than be accepted from
      // the request — otherwise two members could be told they share a folder.
      mockInstanceCreate.mockResolvedValue({ id: 'instance-1' });

      await sandboxWorkspaceRouter.createCaller(ctx).createInstance({
        environmentId,
        name: 'Atlas',
        workingDirectory: 'projects/atlas',
      });

      expect(mockInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sandbox', providerScope: 'ws-org-1' }),
      );
    });

    it('reports an environment it may not use as missing', async () => {
      // The model answers `undefined` for "not yours" and "not there" alike.
      // Telling them apart here would confirm that an id exists.
      mockInstanceCreate.mockResolvedValue(undefined);

      await expect(
        sandboxWorkspaceRouter.createCaller(ctx).createInstance({
          environmentId,
          name: 'Atlas',
          workingDirectory: 'projects/atlas',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('maps a directory already taken by another copy to CONFLICT', async () => {
      mockInstanceCreate.mockRejectedValue(
        uniqueViolation('environment_instances_provider_path_unique'),
      );

      await expect(
        sandboxWorkspaceRouter.createCaller(ctx).createInstance({
          environmentId,
          name: 'Atlas',
          workingDirectory: 'projects/atlas',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_INSTANCE_DIRECTORY' });
    });
  });

  describe('removeInstance', () => {
    const instanceId = '0726286c-f1a1-4c9e-980d-80a8e837321d';

    beforeEach(() => {
      mockInstanceFindOwnedById.mockResolvedValue({ id: instanceId });
    });

    it('deletes the row when the execution plane has no snapshot for it', async () => {
      // An instance nothing has ever run in has nothing on the far side, so a
      // 404 is this step's goal already met. Treating it as a failure strands
      // the row: the environment holding it refuses to go while it is there.
      mockDeleteEnvironment.mockRejectedValue(new SandboxWorkspaceFilesError('gone', 404));

      await sandboxWorkspaceRouter.createCaller(ctx).removeInstance({ id: instanceId });

      expect(mockInstanceDelete).toHaveBeenCalledWith(instanceId);
    });

    it('keeps the row when a session is still using the snapshot', async () => {
      // The one refusal the user can act on, and the reason the snapshot is
      // deleted first: dropping the row here would leave storage nobody can
      // see, name or reclaim.
      mockDeleteEnvironment.mockRejectedValue(new SandboxWorkspaceFilesError('in use', 409));

      await expect(
        sandboxWorkspaceRouter.createCaller(ctx).removeInstance({ id: instanceId }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(mockInstanceDelete).not.toHaveBeenCalled();
    });
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
        caller.updateEnvironment({ id: environmentId, name: 'Data analysis' }),
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

  describe('copyInstance', () => {
    const source = {
      environmentId: '9f8b1c2d-0000-4000-8000-000000000001',
      id: environmentId,
      name: 'Atlas',
      workingDirectory: 'projects/atlas',
    };

    it('forks the copy off the same environment and copies the built state', async () => {
      mockInstanceFindOwnedById.mockResolvedValue(source);
      mockInstanceCreate.mockResolvedValue({ id: 'copy-id' });
      mockCopyEnvironment.mockResolvedValue(undefined);

      await sandboxWorkspaceRouter.createCaller(ctx).copyInstance({
        id: environmentId,
        name: 'Atlas (copy)',
        workingDirectory: 'projects/atlas-copy',
      });

      expect(mockInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: source.environmentId,
          name: 'Atlas (copy)',
          workingDirectory: 'projects/atlas-copy',
        }),
      );
      expect(mockCopyEnvironment).toHaveBeenCalledWith({ from: environmentId, to: 'copy-id' });
    });

    it('removes the row again when the built state fails to copy', async () => {
      // Otherwise the copy is an instance the UI shows as ready while its
      // directory holds nothing — the person would find out by running in it.
      mockInstanceFindOwnedById.mockResolvedValue(source);
      mockInstanceCreate.mockResolvedValue({ id: 'copy-id' });
      mockCopyEnvironment.mockRejectedValue(new Error('upstream down'));

      await expect(
        sandboxWorkspaceRouter.createCaller(ctx).copyInstance({
          id: environmentId,
          name: 'Atlas (copy)',
          workingDirectory: 'projects/atlas-copy',
        }),
      ).rejects.toThrow();
      expect(mockInstanceDelete).toHaveBeenCalledWith('copy-id');
    });
  });
});
