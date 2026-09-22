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
const mockInstanceQuery = vi.fn();

vi.mock('@/database/models/environmentInstance', () => ({
  EnvironmentInstanceModel: vi.fn(function () {
    return {
      create: mockInstanceCreate,
      delete: mockInstanceDelete,
      findById: mockInstanceFindById,
      findOwnedById: mockInstanceFindOwnedById,
      findByWorkingDirectory: vi.fn(),
      query: mockInstanceQuery,
      update: vi.fn(),
    };
  }),
}));

const mockTopicFindByIds = vi.fn();

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findByIds: mockTopicFindByIds };
  }),
}));

const mockCopyEnvironment = vi.fn();
const mockDeleteEnvironment = vi.fn();
const mockListEnvironmentSessions = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {
      getSandboxWorkspaceClient: () => ({
        copyEnvironment: mockCopyEnvironment,
        deleteEnvironment: mockDeleteEnvironment,
        listEnvironmentSessions: mockListEnvironmentSessions,
        writeFile: mockWriteFile,
      }),
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

const mockResolveClaim = vi.fn();

vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxWorkspaceClaim: mockResolveClaim,
}));

const { sandboxWorkspaceRouter } = await import('../sandboxWorkspace');
const { SandboxWorkspaceFilesError } = await import('@/server/services/sandbox/workspaceFiles');
const { ConnectorDataError } = await import('@lobechat/connector-data');

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

  describe('writeFile', () => {
    it('passes the contents through to the execution plane', async () => {
      mockWriteFile.mockResolvedValue({ path: 'work/notes.md' });

      await sandboxWorkspaceRouter
        .createCaller(ctx)
        .writeFile({ content: '# notes', path: 'work/notes.md' });

      expect(mockWriteFile).toHaveBeenCalledWith({ content: '# notes', path: 'work/notes.md' });
    });

    it('refuses a path that climbs out of the workspace', async () => {
      await expect(
        sandboxWorkspaceRouter
          .createCaller(ctx)
          .writeFile({ content: 'x', path: '../../etc/passwd' }),
      ).rejects.toThrow();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('refuses a body past the size ceiling before it reaches the plane', async () => {
      await expect(
        sandboxWorkspaceRouter
          .createCaller(ctx)
          .writeFile({ content: 'x'.repeat(1024 * 1024 + 1), path: 'work/big.txt' }),
      ).rejects.toThrow();

      expect(mockWriteFile).not.toHaveBeenCalled();
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

  describe('listInstanceSessions', () => {
    const instanceA = '0726286c-f1a1-4c9e-980d-80a8e837321d';
    const instanceB = '5a1a0d2e-3b7c-4e2f-9d1a-2c3b4a5d6e7f';

    const record = (overrides: Record<string, unknown>) => ({
      buildId: null,
      endReason: 'idle',
      endedAt: '2026-09-20T11:00:00.000Z',
      environment: instanceA,
      id: 1,
      kind: 'session',
      management: false,
      sessionId: 's',
      sessionUserId: 'user-1',
      snapshotBytes: 10,
      snapshotError: null,
      startedAt: '2026-09-20T10:00:00.000Z',
      topicId: 'topic-1',
      ...overrides,
    });

    beforeEach(() => {
      mockInstanceQuery.mockResolvedValue([
        { environmentId, id: instanceA, name: 'Data' },
        { environmentId, id: instanceB, name: 'Web' },
      ]);
      mockTopicFindByIds.mockResolvedValue([{ id: 'topic-1', title: 'Quarterly report' }]);
    });

    it('merges every instance history newest first, naming the instance and the topic', async () => {
      // One environment has several instances and the execution plane keys
      // history by instance, so the panel's tab is the union of them.
      mockListEnvironmentSessions.mockImplementation(async ({ name }: { name: string }) => ({
        nextBefore: null,
        sessions:
          name === instanceA
            ? [record({ id: 1, startedAt: '2026-09-20T10:00:00.000Z' })]
            : [
                record({
                  environment: instanceB,
                  id: 2,
                  startedAt: '2026-09-21T10:00:00.000Z',
                  topicId: 'sandbox-workspace-console',
                }),
              ],
      }));

      const result = await sandboxWorkspaceRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(result.unavailable).toBe(false);
      expect(result.sessions.map((s) => [s.id, s.instanceName, s.topicTitle])).toEqual([
        [2, 'Web', null],
        [1, 'Data', 'Quarterly report'],
      ]);
      // Keyed by the instance id: that is the name the snapshot store uses.
      expect(mockListEnvironmentSessions).toHaveBeenCalledWith(
        expect.objectContaining({ name: instanceA }),
      );
      expect(mockTopicFindByIds).toHaveBeenCalledWith(['topic-1']);
    });

    it('reports the history as unavailable rather than empty when the control plane fails', async () => {
      mockListEnvironmentSessions.mockRejectedValue(new SandboxWorkspaceFilesError('down', 502));

      const result = await sandboxWorkspaceRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(result).toEqual({ sessions: [], unavailable: true });
    });

    it('answers an environment without instances from the database alone', async () => {
      mockInstanceQuery.mockResolvedValue([]);

      const result = await sandboxWorkspaceRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(result).toEqual({ sessions: [], unavailable: false });
      expect(mockListEnvironmentSessions).not.toHaveBeenCalled();
    });
  });

  describe('listGithubBranches', () => {
    it('lists the branches of one repository through the connected GitHub account', async () => {
      mockListRepositoryBranches.mockResolvedValue(['canary', 'main']);

      const result = await sandboxWorkspaceRouter
        .createCaller(ctx)
        .listGithubBranches({ owner: 'lobehub', repository: 'lobehub' });

      expect(result).toEqual({ branches: ['canary', 'main'], connected: true });
      expect(mockListRepositoryBranches).toHaveBeenCalledWith('lobehub', 'lobehub');
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

      const result = await sandboxWorkspaceRouter
        .createCaller(ctx)
        .listGithubBranches({ owner: 'lobehub', repository: 'lobehub' });

      expect(result).toEqual({ branches: [], connected: false });
    });
  });
});
