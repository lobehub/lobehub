import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  driveFolderExists: vi.fn(),
  findEnvironmentById: vi.fn(),
  EnvironmentInstanceModel: vi.fn(),
  listStorageDirectories: vi.fn(),
  TopicModel: vi.fn(),
  findById: vi.fn(),
  getAgentVisibility: vi.fn(),
  findInstanceById: vi.fn(),
  resolveSandboxStorageClaim: vi.fn(),
  resolveScmCloneCredential: vi.fn(),
}));

const { findById, findInstanceById, getAgentVisibility, resolveSandboxStorageClaim } = mocks;

vi.mock('@/server/services/scm/cloneCredential', () => ({
  resolveScmCloneCredential: mocks.resolveScmCloneCredential,
}));

vi.mock('../entitlement', () => ({
  resolveSandboxStorageClaim: mocks.resolveSandboxStorageClaim,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: mocks.TopicModel,
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentVisibility: mocks.getAgentVisibility };
  }),
}));

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return { findById: mocks.findEnvironmentById };
  }),
}));

vi.mock('@/database/models/environmentInstance', () => ({
  EnvironmentInstanceModel: mocks.EnvironmentInstanceModel,
}));

vi.mock('../driveFolder', () => ({
  driveFolderExists: mocks.driveFolderExists,
}));

const { resolveSandboxSessionConfig } = await import('../session');

const serverDB = {} as LobeChatDatabase;
const CLAIM = { key: 'ws-user_1', quotaBytes: 2048 };
const INSTANCE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveSandboxSessionConfig({
    isShareVisitorRun: false,
    serverDB,
    topicId: 'topic-1',
    userId: 'user_1',
    ...overrides,
  });

describe('resolveSandboxSessionConfig', () => {
  beforeEach(() => {
    resolveSandboxStorageClaim.mockReset();
    findById.mockReset();
    findInstanceById.mockReset();
    getAgentVisibility.mockReset();
    mocks.EnvironmentInstanceModel.mockReset();
    mocks.TopicModel.mockReset();
    mocks.TopicModel.mockImplementation(function () {
      return { findById };
    });
    // A stored instance always names its drive; a fixture that does not say
    // is on the drive this scope resolves to by default.
    mocks.EnvironmentInstanceModel.mockImplementation(function (
      _db: unknown,
      userId: string,
      workspaceId?: string,
    ) {
      const providerScope = workspaceId ? `ws-org-${workspaceId}` : `ws-${userId}`;

      return {
        findById: async (id: string) => {
          const row = await findInstanceById(id);
          return row ? { providerScope, ...row } : row;
        },
        listStorageDirectories: mocks.listStorageDirectories,
      };
    });
    mocks.driveFolderExists.mockReset();
    mocks.driveFolderExists.mockResolvedValue(true);
    mocks.listStorageDirectories.mockReset();
    mocks.listStorageDirectories.mockResolvedValue([]);
    resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
    findById.mockResolvedValue({
      metadata: { sandboxInstanceId: INSTANCE_ID },
    });
    findInstanceById.mockResolvedValue({
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });
  });

  // The instance is one choice with two halves: the directory it works in and
  // the state restored into it. The snapshot is addressed by the instance's own
  // id, which is why two copies of one environment never read each other's.
  it('carries the claim, the mode and the chosen instance', async () => {
    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      cwd: 'projects/atlas',
      environment: INSTANCE_ID,
      mode: 'persistent',
    });
  });

  // A built instance's checkout lives on the sandbox's local disk, so commands
  // run there — while `cwd` keeps naming the instance's directory on the
  // volume, which is what the call belongs to and may see.
  it('runs a built repository instance on local disk, scoped to its directory', async () => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
      id: INSTANCE_ID,
      status: 'ready',
      workingDirectory: 'projects/atlas',
    });

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      cwd: 'projects/atlas',
      environment: INSTANCE_ID,
      mode: 'persistent',
      specification: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
      workingDir: '/root/work',
    });
  });

  // Regression: the definition never reached a conversation, so
  // the declared variables were missing from the agent's shell, the
  // maintenance command never ran once, and the environment's network switch
  // could not cut anything. All three are the execution plane acting on this
  // object, and it only ever received it for a build.
  it('carries the definition the instance was built from', async () => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot: {
        env: { API_URL: 'https://example.com', NODE_ENV: 'production' },
        excludePaths: ['node_modules'],
        internetAccess: false,
        maintenanceCommand: 'git pull --ff-only',
      },
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });

    await expect(resolve()).resolves.toMatchObject({
      specification: {
        env: { API_URL: 'https://example.com', NODE_ENV: 'production' },
        excludePaths: ['node_modules'],
        internetAccess: false,
        maintenanceCommand: 'git pull --ff-only',
      },
    });
  });

  // The column is `jsonb`: its type says "no credentials", but it holds
  // whatever was written to it, and this object now leaves the server on every
  // tool call. So the pick is by name — a key nobody here chose does not
  // travel just because it turned up in the row.
  it('sends only the named fields, whatever else the row holds', async () => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot: {
        credentials: [{ headers: { Authorization: 'Bearer nope' }, host: 'github.com' }],
        env: { NODE_ENV: 'production' },
        requirements: { memoryGiB: 8 },
      },
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });

    const { specification } = await resolve();
    expect(specification).toEqual({ env: { NODE_ENV: 'production' } });
  });

  // `kind` is the product's own: an instance whose environment gained one must
  // send exactly what it sent before, or the execution plane would read every
  // such session as running a different specification from its build.
  it('sends the same specification whether or not the definition carries a kind', async () => {
    const definition = {
      bootstrapCommand: 'pnpm install',
      env: { NODE_ENV: 'production' },
      excludePaths: ['node_modules'],
      internetAccess: false,
      maintenanceCommand: 'git pull --ff-only',
      sources: [{ kind: 'git', url: 'https://github.com/a/b' }],
    };

    findInstanceById.mockResolvedValue({
      configurationSnapshot: definition,
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });
    const { specification: before } = await resolve();

    findInstanceById.mockResolvedValue({
      configurationSnapshot: { ...definition, kind: 'code' },
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });
    const { specification: after } = await resolve();

    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('kind');
  });

  // An empty pick is not an empty object: the runtime adopts whatever it is
  // handed, so a definition with nothing to say must send nothing and leave
  // the session's own defaults alone.
  it.each([
    ['no definition at all', undefined],
    ['a definition with nothing this session acts on', { requirements: { cpu: 2 } }],
    ['an empty variable map', { env: {} }],
    ['a files environment with nothing but its kind', { kind: 'files' }],
  ])('sends no specification for %s', async (_, configurationSnapshot) => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot,
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
    });

    expect(await resolve()).not.toHaveProperty('specification');
  });

  it.each([
    ['not built yet', { status: 'pending' }],
    ['a failed build', { status: 'error' }],
    ['nothing to clone', { configurationSnapshot: { bootstrapCommand: 'echo' }, status: 'ready' }],
  ])('keeps an instance with %s on the volume', async (_, fields) => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
      id: INSTANCE_ID,
      workingDirectory: 'projects/atlas',
      ...fields,
    });

    const config = await resolve();
    expect(config).not.toHaveProperty('workingDir');
    expect(config.cwd).toBe('projects/atlas');
  });

  // Without an entitlement the execution plane routes to the ephemeral sandbox
  // whatever the request says, so reading the topic buys nothing. Leaving the
  // chosen instance untouched on the topic is what lets a resubscription resume
  // exactly where the user left off.
  it('looks no further than the drive when there is no entitlement', async () => {
    resolveSandboxStorageClaim.mockResolvedValue(null);
    findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: 'reports' } });

    await expect(resolve()).resolves.toEqual({
      claim: null,
      drive: 'personal',
      mode: 'ephemeral',
    });
    expect(mocks.driveFolderExists).not.toHaveBeenCalled();
  });

  // The claim is independent of the placement: the drive exists whether or not
  // THIS topic writes to it, and the file browser reads it from a temporary
  // topic just as well. A mode left on an old topic chooses nothing any more.
  it('keeps the claim on a topic that picked nothing', async () => {
    for (const metadata of [{}, { sandboxMode: 'persistent' }]) {
      findById.mockResolvedValue({ metadata });
      await expect(resolve()).resolves.toEqual({
        claim: CLAIM,
        drive: 'personal',
        mode: 'ephemeral',
      });
    }
    expect(findInstanceById).not.toHaveBeenCalled();
  });

  describe("a workspace member's drives", () => {
    it('issues the claim for the drive the topic picked', async () => {
      findById.mockResolvedValue({
        metadata: { sandboxDrive: 'personal', sandboxWorkingDirectory: 'notes' },
      });

      await expect(resolve({ workspaceId: 'ws1' })).resolves.toEqual({
        claim: CLAIM,
        cwd: 'notes',
        drive: 'personal',
        mode: 'drive',
      });
      expect(resolveSandboxStorageClaim).toHaveBeenCalledWith(
        expect.objectContaining({ drive: 'personal', userId: 'user_1', workspaceId: 'ws1' }),
      );
    });

    it('lets a member work at the root of their personal drive', async () => {
      findById.mockResolvedValue({
        metadata: { sandboxDrive: 'personal', sandboxWorkingDirectory: '.' },
      });

      await expect(resolve({ workspaceId: 'ws1' })).resolves.toEqual({
        claim: CLAIM,
        drive: 'personal',
        mode: 'drive',
      });
    });

    it('runs an environment directory on the drive it is on, whatever the topic says', async () => {
      findById.mockResolvedValue({
        metadata: { sandboxDrive: 'public', sandboxInstanceId: INSTANCE_ID },
      });
      findInstanceById.mockResolvedValue({
        id: INSTANCE_ID,
        providerScope: 'ws-mem-ws1-user_1',
        workingDirectory: 'atlas',
      });

      await expect(resolve({ workspaceId: 'ws1' })).resolves.toMatchObject({
        cwd: 'atlas',
        drive: 'personal',
        mode: 'persistent',
      });
    });

    it("refuses an instance on another member's personal drive", async () => {
      findInstanceById.mockResolvedValue({
        id: INSTANCE_ID,
        providerScope: 'ws-mem-ws1-user_2',
        workingDirectory: 'atlas',
      });

      await expect(resolve({ workspaceId: 'ws1' })).resolves.toMatchObject({
        fallback: 'instanceUnavailable',
        mode: 'ephemeral',
      });
    });

    // From before members had drives of their own: hidden on the public drive
    // and not run in, because every member can reach that drive.
    it('asks for a rebuild of a private environment directory left on the public drive', async () => {
      mocks.listStorageDirectories.mockResolvedValue([
        { id: INSTANCE_ID, isPrivate: true, workingDirectory: 'projects/atlas' },
      ]);

      await expect(resolve({ workspaceId: 'ws1' })).resolves.toEqual({
        claim: CLAIM,
        drive: 'public',
        fallback: 'instanceRebuildRequired',
        mode: 'ephemeral',
      });
    });
  });

  describe('a folder on the drive', () => {
    it('runs as a drive in the folder it picked', async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: 'reports/q3' } });

      await expect(resolve()).resolves.toEqual({
        claim: CLAIM,
        drive: 'personal',
        cwd: 'reports/q3',
        mode: 'drive',
      });
      expect(mocks.driveFolderExists).toHaveBeenCalledWith(
        expect.objectContaining({ claim: CLAIM, path: 'reports/q3' }),
      );
    });

    it('runs at the root of a personal drive, which needs no check', async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: '.' } });

      await expect(resolve()).resolves.toEqual({ claim: CLAIM, drive: 'personal', mode: 'drive' });
      expect(mocks.driveFolderExists).not.toHaveBeenCalled();
    });

    // Every member's folders live under a shared drive's root, and a session
    // there is narrowed to the folder it picked — the root narrows nothing.
    it("refuses a shared drive's root and says why", async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: '.' } });

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
        claim: CLAIM,
        drive: 'public',
        fallback: 'rootNotAllowed',
        mode: 'ephemeral',
      });
    });

    // Deleted since it was picked: recreating it would bring back an empty
    // folder under a name someone chose to remove.
    it('falls back to a temporary sandbox when the folder is gone', async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: 'projA' } });
      mocks.driveFolderExists.mockResolvedValue(false);

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
        claim: CLAIM,
        drive: 'public',
        fallback: 'directoryMissing',
        mode: 'ephemeral',
      });
    });

    // A drive that could not be asked is not a folder that is gone.
    it('keeps the folder when the drive cannot answer', async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: 'projA' } });
      mocks.driveFolderExists.mockResolvedValue(undefined);

      await expect(resolve()).resolves.toMatchObject({ cwd: 'projA', mode: 'drive' });
    });

    it('works in a folder inside an environment directory like any other folder', async () => {
      // Environments are one-time initializers now: what one initialized is
      // an ordinary folder, and so is everything inside it.
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: 'atlas/src' } });
      mocks.listStorageDirectories.mockResolvedValue([
        { id: INSTANCE_ID, visible: false, workingDirectory: 'atlas' },
      ]);

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
        claim: CLAIM,
        cwd: 'atlas/src',
        drive: 'public',
        mode: 'drive',
      });
    });

    it('refuses a path that would not survive the fence', async () => {
      findById.mockResolvedValue({ metadata: { sandboxWorkingDirectory: '../other-user' } });

      await expect(resolve()).resolves.toEqual({
        claim: CLAIM,
        drive: 'personal',
        fallback: 'directoryMissing',
        mode: 'ephemeral',
      });
    });

    it('prefers the instance when a topic somehow carries both', async () => {
      findById.mockResolvedValue({
        metadata: { sandboxInstanceId: INSTANCE_ID, sandboxWorkingDirectory: 'projA' },
      });

      await expect(resolve()).resolves.toMatchObject({
        environment: INSTANCE_ID,
        mode: 'persistent',
      });
    });
  });

  // Deleted, or never this member's — the model answers the same for both.
  // Failing the call instead would leave the topic unable to run at all until
  // someone edited a database row; the run is temporary and says why.
  it('falls back to a temporary sandbox when the stored instance no longer resolves', async () => {
    findInstanceById.mockResolvedValue(undefined);

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      fallback: 'instanceUnavailable',
      mode: 'ephemeral',
    });
  });

  // The whole instance goes, not just the directory. Running its packages at
  // the drive root would put one instance's files under another's captured
  // state — silently, which is the failure worth preventing.
  it('drops the whole instance when its directory would not survive the fence', async () => {
    findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: '../other-user' });

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      fallback: 'instanceUnavailable',
      mode: 'ephemeral',
    });
  });

  // A workspace-public agent runs on its caller's session; a private
  // environment's captured state can hold that caller's credentials. The
  // instance is looked up as the public agent, so a private one does not
  // resolve. The run falls back to a temporary directory, never to the shared
  // workspace root, where the private instance's directory would still be
  // reachable — and the composer tells the person why.
  it('looks the instance up as a public agent inside a workspace', async () => {
    findById.mockResolvedValue({
      agentId: 'agent-shared',
      metadata: { sandboxInstanceId: INSTANCE_ID },
    });
    getAgentVisibility.mockResolvedValue('public');
    findInstanceById.mockResolvedValue(undefined);

    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
      claim: CLAIM,
      drive: 'public',
      fallback: 'instanceUnavailable',
      mode: 'ephemeral',
    });
    // The topic is read in the workspace's scope; in the personal scope a
    // workspace topic does not resolve and the run would lose its instance.
    expect(mocks.TopicModel).toHaveBeenCalledWith(serverDB, 'user_1', 'ws-1');
    expect(getAgentVisibility).toHaveBeenCalledWith('agent-shared');
    expect(mocks.EnvironmentInstanceModel).toHaveBeenCalledWith(
      serverDB,
      'user_1',
      'ws-1',
      'public',
    );
  });

  // Personal agents default to 'public' without meaning it, and every
  // personal environment is the owner's own — so no agent read, no narrowing.
  it('does not narrow by agent visibility in personal mode', async () => {
    findById.mockResolvedValue({
      agentId: 'agent-personal',
      metadata: { sandboxInstanceId: INSTANCE_ID },
    });

    await expect(resolve()).resolves.toMatchObject({ environment: INSTANCE_ID });
    expect(getAgentVisibility).not.toHaveBeenCalled();
    expect(mocks.EnvironmentInstanceModel).toHaveBeenCalledWith(
      serverDB,
      'user_1',
      undefined,
      null,
    );
  });

  it('stays ephemeral for a share-visitor run', async () => {
    resolveSandboxStorageClaim.mockResolvedValue(null);

    await expect(resolve({ isShareVisitorRun: true })).resolves.toEqual({
      claim: null,
      drive: 'personal',
      mode: 'ephemeral',
    });
    expect(resolveSandboxStorageClaim).toHaveBeenCalledWith(
      expect.objectContaining({ isShareVisitorRun: true }),
    );
  });

  // A topic read that fails must not fail the tool call; it costs persistence
  // for this turn, which is what every session does today anyway.
  it('degrades to ephemeral when the topic lookup throws', async () => {
    findById.mockRejectedValue(new Error('db down'));

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      mode: 'ephemeral',
    });
  });

  it('degrades to ephemeral when the instance lookup throws', async () => {
    findInstanceById.mockRejectedValue(new Error('db down'));

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      mode: 'ephemeral',
    });
  });

  it('needs no topic to resolve the entitlement', async () => {
    await expect(resolve({ topicId: undefined })).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      mode: 'ephemeral',
    });
    expect(findById).not.toHaveBeenCalled();
  });

  describe('initializing from an environment', () => {
    const environment = {
      configuration: {
        bootstrapCommand: 'pnpm install',
        sources: [{ kind: 'git', url: 'https://github.com/octocat/Hello-World' }],
      },
      id: 'env-1',
      name: 'Hello',
    };

    beforeEach(() => {
      mocks.resolveScmCloneCredential.mockReset().mockResolvedValue(null);
      mocks.findEnvironmentById.mockReset().mockResolvedValue(environment);
    });

    it('initializes a folder on the drive from the environment the topic picked', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      mocks.driveFolderExists.mockResolvedValue(true);
      findById.mockResolvedValue({
        metadata: { sandboxEnvironmentId: 'env-1', sandboxWorkingDirectory: 'app' },
      });

      await expect(resolve()).resolves.toMatchObject({
        cwd: 'app',
        initialization: {
          bootstrapCommand: 'pnpm install',
          environmentId: 'env-1',
          sources: [{ url: 'https://github.com/octocat/Hello-World' }],
        },
        mode: 'drive',
      });
    });

    it('carries the clone credential a private repository needs, resolved for this run', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      findById.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-1' } });
      const credential = { header: 'Authorization: Basic eA==', urlPrefix: 'https://github.com/' };
      mocks.resolveScmCloneCredential.mockResolvedValue(credential);

      await expect(resolve()).resolves.toMatchObject({
        initialization: { cloneCredential: credential, environmentId: 'env-1' },
      });
      expect(mocks.resolveScmCloneCredential).toHaveBeenCalledWith(
        expect.objectContaining({ configuration: environment.configuration, userId: 'user_1' }),
      );
    });

    it('initializes without a credential when none is granted, so a public repository still clones', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      findById.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-1' } });

      const config = await resolve();

      expect(config.initialization).toMatchObject({ environmentId: 'env-1' });
      expect(config.initialization).not.toHaveProperty('cloneCredential');
    });

    it('initializes a temporary sandbox too, which has no drive at all', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      findById.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-1' } });

      await expect(resolve()).resolves.toMatchObject({
        initialization: { environmentId: 'env-1' },
        mode: 'ephemeral',
      });
    });

    it("keeps a member's private environment out of a workspace-public agent", async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      mocks.findEnvironmentById.mockResolvedValue({ ...environment, visibility: 'private' });
      findById.mockResolvedValue({
        agentId: 'agent-shared',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });
      getAgentVisibility.mockResolvedValue('public');

      const config = await resolve({ workspaceId: 'ws-1' });

      expect(getAgentVisibility).toHaveBeenCalledWith('agent-shared');
      expect(config).not.toHaveProperty('initialization');
    });

    it('applies a published environment for a workspace-public agent', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      mocks.findEnvironmentById.mockResolvedValue({ ...environment, visibility: 'public' });
      findById.mockResolvedValue({
        agentId: 'agent-shared',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });
      getAgentVisibility.mockResolvedValue('public');

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
        initialization: { environmentId: 'env-1' },
      });
    });

    it('runs without one when the environment is no longer readable', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      mocks.findEnvironmentById.mockResolvedValue(undefined);
      findById.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-gone' } });

      const config = await resolve();

      expect(config.mode).toBe('ephemeral');
      expect(config).not.toHaveProperty('initialization');
    });

    it('never initializes a legacy instance run, which its build already set up', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: 'atlas' });
      findById.mockResolvedValue({
        metadata: { sandboxEnvironmentId: 'env-1', sandboxInstanceId: INSTANCE_ID },
      });

      const config = await resolve();

      expect(config.mode).toBe('persistent');
      expect(config).not.toHaveProperty('initialization');
      expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
    });
  });
});
