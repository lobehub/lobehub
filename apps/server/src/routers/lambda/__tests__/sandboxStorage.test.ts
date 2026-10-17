// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mock
// ignores the db handle anyway). Real-database behaviour is covered in
// sandboxStorage.drive.test.ts.
const { mockServerDB } = vi.hoisted(() => ({
  mockServerDB: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return mockServerDB;
  }),
}));

const mockCreate = vi.fn();
const mockFindById = vi.fn();
// Separate from `findById` on purpose: the two answer different questions now,
// and a test that stubs the readable lookup must not accidentally satisfy a
// path that is supposed to demand ownership.
const mockFindOwnedById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return {
      create: mockCreate,
      delete: mockDelete,
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
const mockInstanceUpdate = vi.fn();
const mockInstanceRecordBuildResult = vi.fn();
const mockListStorageDirectories = vi.fn();

/**
 * Every stored instance names the drive it is on. The fixtures below mostly
 * leave it out, so a row that does not say is on the caller's public drive —
 * the one `ctx` below resolves to.
 */
const onPublicDrive = <T>(row: T) =>
  row && typeof row === 'object' ? { providerScope: 'ws-org-ws-1', ...row } : row;

vi.mock('@/database/models/environmentInstance', () => ({
  InstanceDirectoryOverlapError: class InstanceDirectoryOverlapError extends Error {},
  EnvironmentInstanceModel: vi.fn(function () {
    return {
      create: mockInstanceCreate,
      delete: mockInstanceDelete,
      findById: async (...args: unknown[]) => onPublicDrive(await mockInstanceFindById(...args)),
      findOwnedById: async (...args: unknown[]) =>
        onPublicDrive(await mockInstanceFindOwnedById(...args)),
      findByWorkingDirectory: vi.fn(),
      listStorageDirectories: mockListStorageDirectories,
      query: async (...args: unknown[]) =>
        ((await mockInstanceQuery(...args)) as unknown[] | undefined)?.map(onPublicDrive),
      recordBuildResult: mockInstanceRecordBuildResult,
      update: mockInstanceUpdate,
    };
  }),
}));

const mockTopicFindByIds = vi.fn();
const mockTopicModel = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/topic', () => ({
  TopicModel: mockTopicModel,
}));

const mockCopyEnvironment = vi.fn();
const mockDeleteEnvironment = vi.fn();
const mockListEnvironmentSessions = vi.fn();
const mockWriteFile = vi.fn();
const mockListFiles = vi.fn();
const mockReadFile = vi.fn();
const mockGetWorkspace = vi.fn();
const mockRefreshUsage = vi.fn();
const mockReadOccupancy = vi.fn();
const mockBuildInstance = vi.fn();
const mockBuildStatus = vi.fn();
const mockListEnvironments = vi.fn();
const mockStopInstance = vi.fn();
const mockRenameFile = vi.fn();
const mockCreateDirectory = vi.fn();

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {
      getSandboxStorageClient: () => ({
        buildInstance: mockBuildInstance,
        buildStatus: mockBuildStatus,
        copyInstance: mockCopyEnvironment,
        createDirectory: mockCreateDirectory,
        deleteInstance: mockDeleteEnvironment,
        getStorage: mockGetWorkspace,
        listEnvironmentSessions: mockListEnvironmentSessions,
        listInstances: mockListEnvironments,
        listFiles: mockListFiles,
        readFile: mockReadFile,
        readOccupancy: mockReadOccupancy,
        refreshUsage: mockRefreshUsage,
        renameFile: mockRenameFile,
        stopInstance: mockStopInstance,
        writeFile: mockWriteFile,
      }),
    };
  }),
}));

const mockResolveClaim = vi.fn();
const mockResolveSessionConfig = vi.fn();

vi.mock('@/server/services/sandbox', async () => ({
  ...(await vi.importActual<object>('@/server/services/sandbox/binding')),
  ...(await vi.importActual<object>('@/server/services/sandbox/driveAccess')),
  ...(await vi.importActual<object>('@/server/services/sandbox/driveUsage')),
  forgetDriveFolders: vi.fn(),
  resolveSandboxSessionConfig: mockResolveSessionConfig,
  resolveSandboxStorageClaim: mockResolveClaim,
}));

const mockResolveCloneCredential = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/scm/cloneCredential', () => ({
  resolveScmCloneCredential: mockResolveCloneCredential,
}));

const { sandboxStorageRouter } = await import('../sandboxStorage');
const { SandboxStorageFilesError } = await import('@/server/services/sandbox/storageFiles');

/** Shaped like the driver error drizzle surfaces, nested behind `cause`. */
const uniqueViolation = (constraint: string) => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as any).cause = { code: '23505', constraint };
  return error;
};

const environmentId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const buildInstanceId = '7b1e9c2a-5d43-4f8a-9c21-8f0e6a3b1d77';

describe('sandboxStorageRouter', () => {
  const ctx: any = { serverDB: mockServerDB, userId: 'user-1', workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveClaim.mockResolvedValue({ key: 'ws-org-1', quotaBytes: 1024 });
    mockInstanceRecordBuildResult.mockResolvedValue(undefined);
    mockReadOccupancy.mockResolvedValue({ held: [], unavailable: false });
    // A folder that is not on the drive yet, which is what a new environment
    // directory or a copy lands in.
    mockListFiles.mockRejectedValue(new SandboxStorageFilesError('not found', 404));
    mockListStorageDirectories.mockResolvedValue([]);
  });

  describe('createInstance', () => {
    beforeEach(() => {
      mockFindOwnedById.mockResolvedValue({
        id: environmentId,
        visibility: 'public',
        workspaceId: 'ws-1',
      });
    });

    it("binds the instance to the caller's own workspace", async () => {
      // The binding is what `environment_instances_provider_path_unique` keys
      // on, so it has to name the caller's storage rather than be accepted from
      // the request — otherwise two members could be told they share a folder.
      mockInstanceCreate.mockResolvedValue({ id: 'instance-1' });

      await sandboxStorageRouter.createCaller(ctx).createInstance({
        environmentId,
        name: 'Atlas',
        workingDirectory: 'atlas',
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
        sandboxStorageRouter.createCaller(ctx).createInstance({
          environmentId,
          name: 'Atlas',
          workingDirectory: 'atlas',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('maps a directory already taken by another copy to CONFLICT', async () => {
      mockInstanceCreate.mockRejectedValue(
        uniqueViolation('environment_instances_provider_path_unique'),
      );

      await expect(
        sandboxStorageRouter.createCaller(ctx).createInstance({
          environmentId,
          name: 'Atlas',
          workingDirectory: 'atlas',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_INSTANCE_DIRECTORY' });
    });

    it('refuses to initialize a folder that already holds work', async () => {
      mockListFiles.mockResolvedValue({ entries: [{ name: 'notes.md' }], path: 'atlas' });

      await expect(
        sandboxStorageRouter.createCaller(ctx).createInstance({
          environmentId,
          name: 'Atlas',
          workingDirectory: 'atlas',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FOLDER_NOT_EMPTY' });
      expect(mockInstanceCreate).not.toHaveBeenCalled();
    });
  });

  describe('removeInstance', () => {
    const instanceId = '0726286c-f1a1-4c9e-980d-80a8e837321d';

    beforeEach(() => {
      mockInstanceFindOwnedById.mockResolvedValue({ environmentId, id: instanceId });
    });

    it('deletes the row when the execution plane has no snapshot for it', async () => {
      // An instance nothing has ever run in has nothing on the far side, so a
      // 404 is this step's goal already met. Treating it as a failure strands
      // the row: the environment holding it refuses to go while it is there.
      mockDeleteEnvironment.mockRejectedValue(new SandboxStorageFilesError('gone', 404));

      await sandboxStorageRouter.createCaller(ctx).removeInstance({ id: instanceId });

      expect(mockInstanceDelete).toHaveBeenCalledWith(instanceId);
    });

    it('keeps the row when a session is still using the snapshot', async () => {
      // The one refusal the user can act on, and the reason the snapshot is
      // deleted first: dropping the row here would leave storage nobody can
      // see, name or reclaim.
      mockDeleteEnvironment.mockRejectedValue(new SandboxStorageFilesError('in use', 409));

      await expect(
        sandboxStorageRouter.createCaller(ctx).removeInstance({ id: instanceId }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(mockInstanceDelete).not.toHaveBeenCalled();
    });
  });

  describe('stopInstance', () => {
    const instanceId = '5f0c3a2e-8b1d-4e6f-9a7c-1d2e3f4a5b6c';

    it("stops the run holding the caller's own instance", async () => {
      mockInstanceFindOwnedById.mockResolvedValue({ id: instanceId });
      mockStopInstance.mockResolvedValue({ stopped: true });

      await expect(
        sandboxStorageRouter.createCaller(ctx).stopInstance({ id: instanceId }),
      ).resolves.toEqual({ stopped: true });

      expect(mockStopInstance).toHaveBeenCalledWith({ name: instanceId });
    });

    it('refuses an instance the caller does not own, before reaching the execution plane', async () => {
      // A published instance is usually held by a colleague's conversation;
      // reading access must not be enough to cut that run off.
      mockInstanceFindOwnedById.mockResolvedValue(undefined);

      await expect(
        sandboxStorageRouter.createCaller(ctx).stopInstance({ id: instanceId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockStopInstance).not.toHaveBeenCalled();
    });

    it("forwards the execution plane's refusal code for the client to translate", async () => {
      mockInstanceFindOwnedById.mockResolvedValue({ id: instanceId });
      mockStopInstance.mockRejectedValue(
        new SandboxStorageFilesError('still saving', 503, 'SNAPSHOT_IN_PROGRESS'),
      );

      await expect(
        sandboxStorageRouter.createCaller(ctx).stopInstance({ id: instanceId }),
      ).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'SNAPSHOT_IN_PROGRESS' });
    });
  });

  describe('writeFile', () => {
    const instanceId = '9b2c7e1a-4d3f-4a8b-9c1d-2e3f4a5b6c7d';

    beforeEach(() => {
      mockInstanceFindOwnedById.mockResolvedValue({ id: instanceId, workingDirectory: 'work' });
    });

    // An instance's directory is the saved copy of its sandbox's work tree and
    // is written by the sandbox alone: a write from here would be
    // overwritten by the next save, or leave the directory disagreeing with
    // the record the next restore reads it by. Refused on the server, not only
    // hidden in the browser — and before the lookup, even for the owner.
    it.each([
      ['writeFile', { content: '# notes', path: 'work/notes.md' }],
      ['createDirectory', { path: 'work/reports' }],
      ['removeFile', { path: 'work/notes.md' }],
    ] as const)('refuses %s into an instance, even for its owner', async (route, input) => {
      await expect(
        (sandboxStorageRouter.createCaller(ctx) as any)[route]({ ...input, instanceId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'INSTANCE_READ_ONLY' });

      expect(mockInstanceFindOwnedById).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('refuses a path that climbs out of the workspace', async () => {
      await expect(
        sandboxStorageRouter
          .createCaller(ctx)
          .writeFile({ content: 'x', instanceId, path: '../../etc/passwd' }),
      ).rejects.toThrow();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('counts the size ceiling in UTF-8 bytes, not UTF-16 units', async () => {
      // A megabyte of CJK is ~3 MiB on the wire. Measured as string length it
      // would pass the guard it is supposed to fail.
      await expect(
        sandboxStorageRouter.createCaller(ctx).writeFile({
          content: '\u4E2D'.repeat(400_000),
          instanceId,
          path: 'work/cjk.txt',
        }),
      ).rejects.toThrow();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('refuses a body past the size ceiling before it reaches the plane', async () => {
      await expect(
        sandboxStorageRouter.createCaller(ctx).writeFile({
          content: 'x'.repeat(1024 * 1024 + 1),
          instanceId,
          path: 'work/big.txt',
        }),
      ).rejects.toThrow();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  // The drive is in reach without an instance — a shared drive's root and its
  // ordinary folders belong to every member — but environment directories are
  // carved out of it: a colleague's private one is hidden, and every one is
  // read-only from outside.
  describe('file routes', () => {
    const instanceId = '9b2c7e1a-4d3f-4a8b-9c1d-2e3f4a5b6c7d';

    it('writes an ordinary folder on a shared drive with no instance named', async () => {
      mockWriteFile.mockResolvedValue({ path: 'projA/a.txt' });

      await sandboxStorageRouter.createCaller(ctx).writeFile({ content: 'x', path: 'projA/a.txt' });

      expect(mockWriteFile).toHaveBeenCalledWith({ content: 'x', path: 'projA/a.txt' });
      expect(mockListStorageDirectories).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'market', providerScope: 'ws-org-1' }),
      );
    });

    it('refuses a write into an environment directory or around one', async () => {
      mockListStorageDirectories.mockResolvedValue([
        { id: instanceId, visible: true, workingDirectory: 'atlas' },
      ]);
      const caller = sandboxStorageRouter.createCaller(ctx);

      await expect(caller.writeFile({ content: 'x', path: 'atlas/a.txt' })).rejects.toThrow(
        'INSTANCE_READ_ONLY',
      );
      await expect(caller.removeFile({ path: 'atlas', recursive: true })).rejects.toThrow(
        'INSTANCE_READ_ONLY',
      );
      await expect(caller.renameFile({ newPath: 'atlas', path: 'projA' })).rejects.toThrow(
        'INSTANCE_READ_ONLY',
      );
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockRenameFile).not.toHaveBeenCalled();
    });

    it('renames an ordinary folder without overwriting', async () => {
      mockRenameFile.mockResolvedValue({ path: 'projB' });

      await expect(
        sandboxStorageRouter.createCaller(ctx).renameFile({ newPath: 'projB', path: 'projA' }),
      ).resolves.toEqual({ path: 'projB' });
      expect(mockRenameFile).toHaveBeenCalledWith({ newPath: 'projB', path: 'projA' });
    });

    it('leaves a private environment directory on the public drive out of the root listing', async () => {
      mockListStorageDirectories.mockResolvedValue([
        { id: instanceId, isPrivate: true, workingDirectory: 'secret' },
      ]);
      mockListFiles.mockResolvedValue({
        entries: [
          { isDirectory: true, name: 'projA', path: 'projA' },
          { isDirectory: true, name: 'secret', path: 'secret' },
        ],
        path: '',
        truncated: false,
      });
      const caller = sandboxStorageRouter.createCaller(ctx);

      const listing = await caller.listFiles({});

      expect(listing.entries.map((entry) => entry.name)).toEqual(['projA']);
      await expect(caller.readFile({ path: 'secret/key' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    // A personal drive is its owner's alone: nothing on it is hidden from them.
    it('hides nothing on the personal drive', async () => {
      mockListStorageDirectories.mockResolvedValue([
        { id: instanceId, isPrivate: true, workingDirectory: 'secret' },
      ]);
      mockListFiles.mockResolvedValue({
        entries: [{ isDirectory: true, name: 'secret', path: 'secret' }],
        path: '',
        truncated: false,
      });

      const listing = await sandboxStorageRouter.createCaller(ctx).listFiles({ drive: 'personal' });

      expect(listing.entries.map((entry) => entry.name)).toEqual(['secret']);
      expect(mockResolveClaim).toHaveBeenCalledWith(expect.objectContaining({ drive: 'personal' }));
    });

    it("refuses a read outside the instance's directory", async () => {
      mockInstanceFindById.mockResolvedValue({ id: instanceId, workingDirectory: 'work' });

      for (const path of ['other/a.txt', 'workshop/a.txt']) {
        await expect(
          sandboxStorageRouter.createCaller(ctx).readFile({ instanceId, path }),
        ).rejects.toThrow('PATH_OUTSIDE_INSTANCE');
      }
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("lists the instance's own directory when no path is given", async () => {
      mockInstanceFindById.mockResolvedValue({ id: instanceId, workingDirectory: 'work' });
      mockListFiles.mockResolvedValue({ entries: [] });

      await sandboxStorageRouter.createCaller(ctx).listFiles({ instanceId });

      expect(mockInstanceFindById).toHaveBeenCalledWith(instanceId);
      expect(mockListFiles).toHaveBeenCalledWith(expect.objectContaining({ path: 'work' }));
    });

    it("lists a conversation's own folder when it names a topic and no path", async () => {
      mockResolveSessionConfig.mockResolvedValue({ cwd: 'projA', mode: 'drive' });
      mockListFiles.mockResolvedValue({ entries: [] });

      await sandboxStorageRouter.createCaller(ctx).listFiles({ topicId: 'topic-1' });
      expect(mockListFiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: 'projA', topicId: 'topic-1' }),
      );

      // A temporary conversation has no folder of its own: the drive's root.
      mockResolveSessionConfig.mockResolvedValue({ mode: 'ephemeral' });
      await sandboxStorageRouter.createCaller(ctx).listFiles({ topicId: 'topic-1' });
      expect(mockListFiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: undefined, topicId: 'topic-1' }),
      );
    });
  });

  describe('copyInstance', () => {
    it('arrives ready, because a copy has everything the source built', async () => {
      // Left at the insert's default it would sit in `pending` with no build
      // to wait for — which reads as "never built" and offers a rebuild that
      // would throw the copy away.
      mockResolveSessionConfig.mockResolvedValue({ claim: { key: 'ws-org-1' } });
      mockInstanceFindById.mockResolvedValue({
        environmentId,
        id: buildInstanceId,
        workingDirectory: 'src',
      });
      mockInstanceCreate.mockResolvedValue({ id: 'copy-1', workingDirectory: 'copy' });
      mockCopyEnvironment.mockResolvedValue({});

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .copyInstance({ id: buildInstanceId, name: 'copy', workingDirectory: 'copy' });

      expect(mockInstanceUpdate).toHaveBeenCalledWith('copy-1', { status: 'ready' });
      expect(result.status).toBe('ready');
    });

    describe('while the source is held', () => {
      beforeEach(() => {
        mockInstanceFindOwnedById.mockResolvedValue({
          environmentId,
          id: buildInstanceId,
          workingDirectory: 'src',
        });
      });

      it('refuses a source a conversation is holding, before any row exists', async () => {
        // A held instance is mid-write; a copy would capture a half-changed tree.
        mockReadOccupancy.mockResolvedValue({
          held: [{ id: buildInstanceId, own: false }],
          unavailable: false,
        });

        await expect(
          sandboxStorageRouter
            .createCaller(ctx)
            .copyInstance({ id: buildInstanceId, name: 'copy', workingDirectory: 'copy' }),
        ).rejects.toMatchObject({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });

        expect(mockReadOccupancy).toHaveBeenCalledWith({ names: [buildInstanceId] });
        expect(mockInstanceCreate).not.toHaveBeenCalled();
        expect(mockCopyEnvironment).not.toHaveBeenCalled();
      });

      it('refuses when the lease store cannot answer, rather than reading it as free', async () => {
        mockReadOccupancy.mockRejectedValue(new Error('redis down'));

        await expect(
          sandboxStorageRouter
            .createCaller(ctx)
            .copyInstance({ id: buildInstanceId, name: 'copy', workingDirectory: 'copy' }),
        ).rejects.toMatchObject({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });

        expect(mockInstanceCreate).not.toHaveBeenCalled();
        expect(mockCopyEnvironment).not.toHaveBeenCalled();
      });

      it('refuses when the lease store reports itself unavailable', async () => {
        mockReadOccupancy.mockResolvedValue({ held: [], unavailable: true });

        await expect(
          sandboxStorageRouter
            .createCaller(ctx)
            .copyInstance({ id: buildInstanceId, name: 'copy', workingDirectory: 'copy' }),
        ).rejects.toMatchObject({ message: 'INSTANCE_IN_USE' });

        expect(mockInstanceCreate).not.toHaveBeenCalled();
      });
    });
  });

  describe('startInstanceBuild', () => {
    const spec = { bootstrapCommand: 'pnpm i', sources: [{ kind: 'git', url: 'https://x/y' }] };

    beforeEach(() => {
      mockResolveSessionConfig.mockResolvedValue({ claim: { key: 'ws-org-1' } });
      mockReadOccupancy.mockResolvedValue({ held: [], unavailable: false });
      mockResolveCloneCredential.mockResolvedValue(null);
    });

    it('builds from the definition the instance was created from', async () => {
      // Not the environment's current one: a build has to produce what the
      // instance says it is, and the two differ exactly when it moved on.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
        workingDirectory: 'atlas',
      });
      mockBuildInstance.mockResolvedValue({ buildId: 'b-1' });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });

      // The instance's own folder is where the checkout lands on the volume,
      // which is what its file browser opens.
      expect(mockBuildInstance).toHaveBeenCalledWith({
        credentials: undefined,
        instanceDir: 'atlas',
        name: buildInstanceId,
        specification: spec,
        topicId: 'tpc-1',
      });
      expect(result.buildId).toBe('b-1');
      expect(mockInstanceUpdate).toHaveBeenLastCalledWith(buildInstanceId, { buildId: 'b-1' });
    });

    // The execution plane digests the specification it is sent to decide which
    // build a snapshot belongs to. `kind` only picks the form the product
    // shows, so an instance created after its environment gained one must be
    // sent exactly what it would have been sent before.
    it('sends the same specification whether or not the definition carries a kind', async () => {
      mockBuildInstance.mockResolvedValue({ buildId: 'b-1' });

      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
        workingDirectory: 'atlas',
      });
      await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });
      const before = mockBuildInstance.mock.lastCall?.[0].specification;

      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: { ...spec, kind: 'code' },
        id: buildInstanceId,
        workingDirectory: 'atlas',
      });
      await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });
      const after = mockBuildInstance.mock.lastCall?.[0].specification;

      expect(after).toEqual(before);
      expect(after).toEqual(spec);
      expect(after).not.toHaveProperty('kind');
    });

    // A files environment clones nothing and installs nothing, so its instance
    // is ready the moment it exists rather than waiting on a sandbox.
    it('settles a files environment ready without starting a build', async () => {
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: { kind: 'files' },
        id: buildInstanceId,
        workingDirectory: 'notes',
      });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(result).toEqual({ buildId: null });
      expect(mockBuildInstance).not.toHaveBeenCalled();
      expect(mockInstanceUpdate).toHaveBeenCalledWith(buildInstanceId, { status: 'ready' });
    });

    it('carries the App installation credential when one could be minted', async () => {
      // Resolved on this side because the App's private key lives here; the
      // execution plane is handed the result and never the inputs.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
      });
      mockBuildInstance.mockResolvedValue({ buildId: 'b-2' });
      const credential = { header: 'Authorization: Basic x', urlPrefix: 'https://github.com/' };
      mockResolveCloneCredential.mockResolvedValue(credential);

      await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockResolveCloneCredential).toHaveBeenCalledWith({
        configuration: spec,
        db: ctx.serverDB,
        userId: 'user-1',
        workspaceId: 'ws-1',
      });
      expect(mockBuildInstance).toHaveBeenCalledWith(
        expect.objectContaining({ credentials: [credential] }),
      );
    });

    it('builds without a credential rather than refusing when none can be minted', async () => {
      // The execution plane still has its own connection, and a clone that
      // fails says so in the build log where someone can act on it.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
      });
      mockBuildInstance.mockResolvedValue({ buildId: 'b-3' });
      mockResolveCloneCredential.mockResolvedValue(null);

      await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockBuildInstance).toHaveBeenCalledWith(
        expect.objectContaining({ credentials: undefined }),
      );
    });

    it('settles an instance with nothing to build without touching the sandbox', async () => {
      // Cold-starting a microVM to clone nothing and install nothing would
      // leave an empty archive behind and minutes on the clock.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: {},
        id: buildInstanceId,
      });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .startInstanceBuild({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockBuildInstance).not.toHaveBeenCalled();
      expect(result.buildId).toBeNull();
      expect(mockInstanceUpdate).toHaveBeenCalledWith(buildInstanceId, { status: 'ready' });
    });

    it('records a refused build on the row, not only in the response', async () => {
      // The client that asked may already be gone, and an instance left
      // saying "pending" forever is the one state nothing recovers from.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
      });
      mockBuildInstance.mockRejectedValue(new Error('environment in use'));

      await expect(
        sandboxStorageRouter
          .createCaller(ctx)
          .startInstanceBuild({ id: buildInstanceId, topicId: 't' }),
      ).rejects.toThrow('environment in use');

      expect(mockInstanceUpdate).toHaveBeenLastCalledWith(buildInstanceId, {
        buildError: 'environment in use',
        status: 'error',
      });
    });

    it('refuses to rebuild an instance a conversation is holding, leaving the row alone', async () => {
      // A rebuild replaces the folder that conversation is writing in.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
        status: 'ready',
      });
      mockReadOccupancy.mockResolvedValue({
        held: [{ id: buildInstanceId, own: false }],
        unavailable: false,
      });

      await expect(
        sandboxStorageRouter
          .createCaller(ctx)
          .startInstanceBuild({ id: buildInstanceId, topicId: 't' }),
      ).rejects.toThrow('INSTANCE_IN_USE');

      expect(mockBuildInstance).not.toHaveBeenCalled();
      expect(mockInstanceUpdate).not.toHaveBeenCalled();
    });

    it('puts a ready instance back to ready when its rebuild never starts', async () => {
      // Nothing was published, so everything the last build left is still
      // there — reading "failed" would send someone to fix a working copy.
      mockInstanceFindOwnedById.mockResolvedValue({
        configurationSnapshot: spec,
        id: buildInstanceId,
        status: 'ready',
      });
      mockBuildInstance.mockRejectedValue(new Error('environment in use'));

      await expect(
        sandboxStorageRouter
          .createCaller(ctx)
          .startInstanceBuild({ id: buildInstanceId, topicId: 't' }),
      ).rejects.toThrow('environment in use');

      expect(mockInstanceUpdate).toHaveBeenLastCalledWith(buildInstanceId, { status: 'ready' });
    });
  });

  describe('instanceBuildStatus', () => {
    beforeEach(() => {
      mockResolveSessionConfig.mockResolvedValue({ claim: { key: 'ws-org-1' } });
    });

    it('clears the build id with the verdict', async () => {
      // The runtime drops a finished build's log on its own schedule, and an
      // id that outlives it has the UI polling for a log that never comes.
      mockInstanceFindById.mockResolvedValue({
        buildId: 'b-1',
        id: buildInstanceId,
        status: 'pending',
      });
      mockBuildStatus.mockResolvedValue({ chunk: 'done', logOffset: 4, state: 'succeeded' });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .instanceBuildStatus({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(result.state).toBe('succeeded');
      expect(mockInstanceRecordBuildResult).toHaveBeenCalledWith(buildInstanceId, 'b-1', {
        buildError: null,
        status: 'ready',
      });
    });

    it('keeps the failure log on the row so the reason outlives the build', async () => {
      mockInstanceFindById.mockResolvedValue({
        buildId: 'b-1',
        id: buildInstanceId,
        status: 'pending',
      });
      mockBuildStatus.mockResolvedValue({ chunk: 'npm ERR! 404', logOffset: 12, state: 'failed' });

      await sandboxStorageRouter
        .createCaller(ctx)
        .instanceBuildStatus({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockInstanceRecordBuildResult).toHaveBeenCalledWith(buildInstanceId, 'b-1', {
        buildError: 'npm ERR! 404',
        status: 'error',
      });
    });

    it('records the verdict against the build it polled, not whoever polled it', async () => {
      // A viewer of a published environment can be the one whose poll receives
      // the terminal status. The write goes through the visibility-scoped
      // recorder and names the build, so the owner's row still settles and a
      // superseded build cannot clobber a newer one.
      mockInstanceFindById.mockResolvedValue({
        buildId: 'b-7',
        id: buildInstanceId,
        status: 'pending',
      });
      mockBuildStatus.mockResolvedValue({ chunk: 'done', logOffset: 4, state: 'succeeded' });

      await sandboxStorageRouter
        .createCaller(ctx)
        .instanceBuildStatus({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockInstanceRecordBuildResult).toHaveBeenCalledWith(buildInstanceId, 'b-7', {
        buildError: null,
        status: 'ready',
      });
      expect(mockInstanceUpdate).not.toHaveBeenCalled();
    });

    it('asks the execution plane nothing when no build is in flight', async () => {
      mockInstanceFindById.mockResolvedValue({
        buildId: null,
        id: buildInstanceId,
        status: 'ready',
      });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .instanceBuildStatus({ id: buildInstanceId, topicId: 'tpc-1' });

      expect(mockBuildStatus).not.toHaveBeenCalled();
      expect(result.state).toBe('idle');
    });
  });

  describe('listInstances', () => {
    const instance = (id: string) => ({
      createdAt: new Date(0),
      environmentId,
      id,
      name: id,
      workingDirectory: id,
    });

    beforeEach(() => {
      mockResolveSessionConfig.mockResolvedValue({ claim: { key: 'ws-org-1' } });
      mockReadOccupancy.mockResolvedValue({ held: [], unavailable: false });
    });

    it('settles a build that finished while nobody had the panel open', async () => {
      // The per-build poll only runs while the Instances tab is mounted. Switch
      // tabs mid-build and the verdict never lands, so the row stays pending
      // against a build the runtime has discarded. The listing settles it.
      mockInstanceQuery.mockResolvedValue([
        { ...instance('inst-built'), buildId: 'b-9', status: 'pending' },
      ]);
      mockBuildStatus.mockResolvedValue({ chunk: 'ok', logOffset: 2, state: 'succeeded' });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstances({ topicId: 'tpc-1', withSizes: false });

      expect(mockInstanceRecordBuildResult).toHaveBeenCalledWith('inst-built', 'b-9', {
        buildError: null,
        status: 'ready',
      });
      expect(result.instances[0]).toMatchObject({ buildId: null, status: 'ready' });
    });

    it('leaves a still-running build alone', async () => {
      mockInstanceQuery.mockResolvedValue([
        { ...instance('inst-building'), buildId: 'b-10', status: 'pending' },
      ]);
      mockBuildStatus.mockResolvedValue({ chunk: '', logOffset: 0, state: 'running' });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstances({ topicId: 'tpc-1', withSizes: false });

      expect(mockInstanceRecordBuildResult).not.toHaveBeenCalled();
      expect(result.instances[0]).toMatchObject({ buildId: 'b-10', status: 'pending' });
    });

    it('marks an instance another conversation holds, and tells its own run apart', async () => {
      // The execution plane allows one session per instance and answers the
      // second writer with 409, so a picker that cannot tell these apart
      // either offers a choice the next message refuses, or takes an instance
      // away from the conversation that is running in it.
      mockInstanceQuery.mockResolvedValue([
        instance('inst-a'),
        instance('inst-b'),
        instance('inst-c'),
      ]);
      mockReadOccupancy.mockResolvedValue({
        held: [
          { id: 'inst-a', own: false },
          { id: 'inst-b', own: true },
        ],
        unavailable: false,
      });

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstances({ topicId: 'tpc-1', withSizes: false });

      expect(mockReadOccupancy).toHaveBeenCalledWith({
        names: ['inst-a', 'inst-b', 'inst-c'],
        topicId: 'tpc-1',
      });
      expect(result.instances.map((i: any) => [i.id, i.inUse, i.inUseByThisTopic])).toEqual([
        ['inst-a', true, false],
        ['inst-b', true, true],
        ['inst-c', false, false],
      ]);
      expect(result.occupancyUnavailable).toBe(false);
    });

    it('reports occupancy as unknown rather than free when the lease store fails', async () => {
      // "Free" on the strength of a call that did not answer would let a
      // picker offer an instance another conversation is actively writing.
      mockInstanceQuery.mockResolvedValue([instance('inst-a')]);
      mockReadOccupancy.mockRejectedValue(new Error('market down'));

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstances({ topicId: 'tpc-1', withSizes: false });

      expect(result.occupancyUnavailable).toBe(true);
      expect(result.instances[0].inUse).toBe(false);
    });

    it('asks nothing of the execution plane when there are no instances', async () => {
      mockInstanceQuery.mockResolvedValue([]);

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstances({ topicId: 'tpc-1', withSizes: false });

      expect(mockReadOccupancy).not.toHaveBeenCalled();
      expect(result.occupancyUnavailable).toBe(false);
    });
  });

  describe('entitlement', () => {
    it('refuses every drive call without a claim', async () => {
      // The execution plane would reject these anyway. Failing here keeps a
      // client that renders the picker too eagerly from looking like a server
      // fault, and keeps an unentitled caller from reaching the market at all.
      // The definitions these are built from need no drive — see `environment`.
      mockResolveClaim.mockResolvedValue(null);
      const caller = sandboxStorageRouter.createCaller(ctx);

      await expect(
        caller.createInstance({ environmentId, name: 'atlas', workingDirectory: 'atlas' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.listFiles({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockInstanceCreate).not.toHaveBeenCalled();
      expect(mockListFiles).not.toHaveBeenCalled();
    });
  });

  describe('workspace storage', () => {
    const info = {
      dir: '/mnt/workspace/ws-user_1',
      key: 'ws-user_1',
      quotaBytes: 8_589_934_592,
      status: 'active',
      usageBytes: 166_731,
      usageCheckedAt: '2026-09-23T05:11:00.767Z',
    };

    it('reads the stored figure without measuring', async () => {
      // A page load must not walk the volume, and must not stamp the workspace
      // as active — that is the signal an idle sweep selects on.
      mockGetWorkspace.mockResolvedValue(info);
      const caller = sandboxStorageRouter.createCaller(ctx);

      await expect(caller.getStorage()).resolves.toMatchObject({ usageBytes: 166_731 });
      expect(mockRefreshUsage).not.toHaveBeenCalled();
    });

    it('measures only when the caller asks', async () => {
      mockRefreshUsage.mockResolvedValue({ ...info, usageBytes: 4_096 });
      const caller = sandboxStorageRouter.createCaller(ctx);

      await expect(caller.refreshStorageUsage()).resolves.toMatchObject({ usageBytes: 4_096 });
      expect(mockRefreshUsage).toHaveBeenCalledTimes(1);
    });

    it('refuses to measure without a workspace claim', async () => {
      mockResolveClaim.mockResolvedValue(null);
      const caller = sandboxStorageRouter.createCaller(ctx);

      await expect(caller.refreshStorageUsage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockRefreshUsage).not.toHaveBeenCalled();
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
      mockInstanceCreate.mockResolvedValue({
        id: 'copy-id',
        workingDirectory: 'atlas-copy',
      });
      mockCopyEnvironment.mockResolvedValue(undefined);

      await sandboxStorageRouter.createCaller(ctx).copyInstance({
        id: environmentId,
        name: 'Atlas (copy)',
        workingDirectory: 'atlas-copy',
      });

      expect(mockInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: source.environmentId,
          name: 'Atlas (copy)',
          workingDirectory: 'atlas-copy',
        }),
      );
      // The copy's own folder, never the source's: sharing one would let either
      // instance's next save delete what the other still lists.
      expect(mockCopyEnvironment).toHaveBeenCalledWith({
        from: environmentId,
        instanceDir: 'atlas-copy',
        to: 'copy-id',
      });
    });

    it('removes the row again when the built state fails to copy', async () => {
      // Otherwise the copy is an instance the UI shows as ready while its
      // directory holds nothing — the person would find out by running in it.
      mockInstanceFindOwnedById.mockResolvedValue(source);
      mockInstanceCreate.mockResolvedValue({ id: 'copy-id' });
      mockCopyEnvironment.mockRejectedValue(new Error('upstream down'));

      await expect(
        sandboxStorageRouter.createCaller(ctx).copyInstance({
          id: environmentId,
          name: 'Atlas (copy)',
          workingDirectory: 'atlas-copy',
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
      mockTopicModel.mockImplementation(function () {
        return { findByIds: mockTopicFindByIds };
      });
      mockTopicFindByIds.mockResolvedValue([
        { id: 'topic-1', title: 'Quarterly report', userId: 'user-1' },
      ]);
    });

    // In the personal scope a workspace topic never matches, so every row of a
    // workspace environment would lose its title. The workspace scope also
    // reaches colleagues' topics, which keep their id only.
    it('names the workspace topics the caller started, and only those', async () => {
      mockListEnvironmentSessions.mockImplementation(async ({ name }: { name: string }) => ({
        nextBefore: null,
        sessions:
          name === instanceA
            ? [
                record({ id: 1, topicId: 'topic-1' }),
                record({ id: 2, sessionUserId: 'user-2', topicId: 'topic-2' }),
              ]
            : [],
      }));
      mockTopicFindByIds.mockResolvedValue([
        { id: 'topic-1', title: 'Quarterly report', userId: 'user-1' },
        { id: 'topic-2', title: 'A colleague topic', userId: 'user-2' },
      ]);

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(mockTopicModel).toHaveBeenCalledWith(ctx.serverDB, 'user-1', 'ws-1');
      expect(Object.fromEntries(result.sessions.map((s) => [s.topicId, s.topicTitle]))).toEqual({
        'topic-1': 'Quarterly report',
        'topic-2': null,
      });
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

      const result = await sandboxStorageRouter
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
      mockListEnvironmentSessions.mockRejectedValue(new SandboxStorageFilesError('down', 502));

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(result).toEqual({ sessions: [], unavailable: true });
    });

    it('answers an environment without instances from the database alone', async () => {
      mockInstanceQuery.mockResolvedValue([]);

      const result = await sandboxStorageRouter
        .createCaller(ctx)
        .listInstanceSessions({ environmentId });

      expect(result).toEqual({ sessions: [], unavailable: false });
      expect(mockListEnvironmentSessions).not.toHaveBeenCalled();
    });
  });
});
