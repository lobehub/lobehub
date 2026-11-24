import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  driveFolderExists: vi.fn(),
  ensureDriveFolder: vi.fn(),
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
  // One repository: the single host-wide credential, as a list.
  resolveScmCloneCredentials: async (params: unknown) => {
    const credential = await mocks.resolveScmCloneCredential(params);
    return credential ? [credential] : [];
  },
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
  ensureDriveFolder: mocks.ensureDriveFolder,
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
    mocks.ensureDriveFolder.mockReset();
    mocks.ensureDriveFolder.mockResolvedValue(true);
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

  // T-14825: the cloud sandbox is not set up from an environment any more. A
  // conversation still bound to a legacy environment directory runs in that
  // directory as a plain folder on the drive — its files stay where they are.
  it('runs a legacy environment directory as a folder, without its environment', async () => {
    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      cwd: 'projects/atlas',
      mode: 'drive',
    });
  });

  // The row outlives a folder renamed or deleted through the drive browser:
  // the run falls back like any other missing folder instead of a bad cwd.
  it("falls back when a legacy instance's folder is gone from the drive", async () => {
    mocks.driveFolderExists.mockResolvedValue(false);

    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      drive: 'personal',
      fallback: 'directoryMissing',
      mode: 'ephemeral',
    });
    expect(mocks.driveFolderExists).toHaveBeenCalledWith(
      expect.objectContaining({ claim: CLAIM, path: 'projects/atlas' }),
    );
    expect(mocks.ensureDriveFolder).not.toHaveBeenCalled();
  });

  // Neither the definition the instance was built from, nor its snapshot, nor
  // the checkout its build left on local disk come along.
  it("leaves the instance's definition, snapshot and checkout behind", async () => {
    findInstanceById.mockResolvedValue({
      configurationSnapshot: {
        bootstrapCommand: 'pnpm install',
        env: { NODE_ENV: 'production' },
        sources: [{ kind: 'git', url: 'https://github.com/a/b' }],
      },
      id: INSTANCE_ID,
      status: 'ready',
      workingDirectory: 'projects/atlas',
    });

    const config = await resolve();
    expect(config).toEqual({
      claim: CLAIM,
      cwd: 'projects/atlas',
      drive: 'personal',
      mode: 'drive',
    });
    expect(config).not.toHaveProperty('environment');
    expect(config).not.toHaveProperty('specification');
    expect(config).not.toHaveProperty('workingDir');
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
        mode: 'drive',
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
      expect(mocks.ensureDriveFolder).not.toHaveBeenCalled();
    });

    // A repository's checkout is filled by its environment, so bringing the
    // folder back is a fresh clone — which is how a project conversation's
    // checkout is made on its first run.
    it("creates a repository checkout's folder the drive does not have yet", async () => {
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: {
          sandboxEnvironmentId: 'env-1',
          sandboxWorkingDirectory: 'projects/atlas/repo',
        },
      });
      mocks.driveFolderExists.mockResolvedValue(false);

      await expect(resolve()).resolves.toMatchObject({
        cwd: 'projects/atlas/repo',
        mode: 'drive',
      });
      expect(mocks.ensureDriveFolder).toHaveBeenCalledWith(
        expect.objectContaining({ claim: CLAIM, path: 'projects/atlas/repo', topicId: 'topic-1' }),
      );
    });

    it('falls back when a checkout folder cannot be created', async () => {
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: {
          sandboxEnvironmentId: 'env-1',
          sandboxWorkingDirectory: 'projects/atlas/repo',
        },
      });
      mocks.driveFolderExists.mockResolvedValue(false);
      mocks.ensureDriveFolder.mockResolvedValue(false);

      await expect(resolve()).resolves.toMatchObject({
        fallback: 'directoryMissing',
        mode: 'ephemeral',
      });
    });

    // A drive that could not be asked is not a folder that is gone.
    // T-14825: only a project conversation is set up from an environment, so
    // only its checkout is brought back. Anywhere else a missing folder is
    // missing, whatever environment the topic still carries.
    it('does not recreate a missing folder for an environment outside a project', async () => {
      findById.mockResolvedValue({
        metadata: { sandboxEnvironmentId: 'env-1', sandboxWorkingDirectory: 'projects/atlas/repo' },
      });
      mocks.driveFolderExists.mockResolvedValue(false);

      await expect(resolve()).resolves.toMatchObject({
        fallback: 'directoryMissing',
        mode: 'ephemeral',
      });
      expect(mocks.ensureDriveFolder).not.toHaveBeenCalled();
    });

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
        cwd: 'projects/atlas',
        mode: 'drive',
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

    await expect(resolve()).resolves.toMatchObject({ cwd: 'projects/atlas', mode: 'drive' });
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

  // Only a project conversation is set up from an environment: its project's.
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
        projectId: 'project-1',
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
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });
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
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });

      const config = await resolve();

      expect(config.initialization).toMatchObject({ environmentId: 'env-1' });
      expect(config.initialization).not.toHaveProperty('cloneCredential');
    });

    it('initializes a temporary sandbox too, which has no drive at all', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });

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
        projectId: 'project-1',
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
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1' },
      });
      getAgentVisibility.mockResolvedValue('public');

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
        initialization: { environmentId: 'env-1' },
      });
    });

    // T-14791: a folder and an environment can now be picked together, so a
    // private environment could otherwise be checked out where every member
    // of the workspace can browse it.
    it("keeps a private environment out of a folder on the workspace's public drive", async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      mocks.driveFolderExists.mockResolvedValue(true);
      mocks.findEnvironmentById.mockResolvedValue({ ...environment, visibility: 'private' });
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1', sandboxWorkingDirectory: 'team' },
      });

      const config = await resolve({ workspaceId: 'ws-1' });

      expect(config).toMatchObject({ cwd: 'team', drive: 'public', mode: 'drive' });
      expect(config).not.toHaveProperty('initialization');
    });

    it("applies a private environment in a folder on the member's personal drive", async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      mocks.driveFolderExists.mockResolvedValue(true);
      mocks.findEnvironmentById.mockResolvedValue({ ...environment, visibility: 'private' });
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: {
          sandboxDrive: 'personal',
          sandboxEnvironmentId: 'env-1',
          sandboxWorkingDirectory: 'mine',
        },
      });

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
        drive: 'personal',
        initialization: { environmentId: 'env-1' },
        mode: 'drive',
      });
    });

    it('applies a published environment in a folder on the public drive', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      mocks.driveFolderExists.mockResolvedValue(true);
      mocks.findEnvironmentById.mockResolvedValue({ ...environment, visibility: 'public' });
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-1', sandboxWorkingDirectory: 'team' },
      });

      await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
        drive: 'public',
        initialization: { environmentId: 'env-1' },
      });
    });

    it('runs without one when the environment is no longer readable', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(null);
      mocks.findEnvironmentById.mockResolvedValue(undefined);
      findById.mockResolvedValue({
        projectId: 'project-1',
        metadata: { sandboxEnvironmentId: 'env-gone' },
      });

      const config = await resolve();

      expect(config.mode).toBe('ephemeral');
      expect(config).not.toHaveProperty('initialization');
    });

    // T-14825: the cloud sandbox is not set up from an environment outside a
    // project any more. One a conversation still carries from before is
    // ignored — the run goes ahead without it, rather than failing.
    it.each([
      ['a temporary sandbox', {}, 'ephemeral'],
      ['a folder on the drive', { sandboxWorkingDirectory: 'app' }, 'drive'],
    ])('ignores an environment outside a project in %s', async (_, placement, mode) => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      findById.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env-1', ...placement } });

      const config = await resolve();

      expect(config.mode).toBe(mode);
      expect(config).not.toHaveProperty('initialization');
      expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
    });

    it('runs a legacy instance outside a project without any environment', async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: 'atlas' });
      findById.mockResolvedValue({
        metadata: { sandboxEnvironmentId: 'env-1', sandboxInstanceId: INSTANCE_ID },
      });

      const config = await resolve();

      expect(config).toMatchObject({ cwd: 'atlas', mode: 'drive' });
      expect(config).not.toHaveProperty('initialization');
      expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
    });

    // A project conversation keeps its project's environment, but a legacy
    // instance's folder already holds that conversation's work: cloning or
    // bootstrapping into it is not "running without the environment".
    it("never initializes a legacy instance's folder, even in a project", async () => {
      resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
      findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: 'atlas' });
      findById.mockResolvedValue({
        metadata: { sandboxEnvironmentId: 'env-1', sandboxInstanceId: INSTANCE_ID },
        projectId: 'project-1',
      });

      const config = await resolve();

      expect(config).toMatchObject({ cwd: 'atlas', mode: 'drive' });
      expect(config).not.toHaveProperty('initialization');
      expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
    });
  });
});
