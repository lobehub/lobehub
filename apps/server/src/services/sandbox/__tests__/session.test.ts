import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  EnvironmentInstanceModel: vi.fn(),
  TopicModel: vi.fn(),
  findById: vi.fn(),
  getAgentVisibility: vi.fn(),
  findInstanceById: vi.fn(),
  resolveSandboxStorageClaim: vi.fn(),
}));

const { findById, findInstanceById, getAgentVisibility, resolveSandboxStorageClaim } = mocks;

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

vi.mock('@/database/models/environmentInstance', () => ({
  EnvironmentInstanceModel: mocks.EnvironmentInstanceModel,
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
    mocks.EnvironmentInstanceModel.mockImplementation(function () {
      return { findById: findInstanceById };
    });
    resolveSandboxStorageClaim.mockResolvedValue(CLAIM);
    findById.mockResolvedValue({
      metadata: { sandboxInstanceId: INSTANCE_ID, sandboxMode: 'persistent' },
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

  // An empty pick is not an empty object: the runtime adopts whatever it is
  // handed, so a definition with nothing to say must send nothing and leave
  // the session's own defaults alone.
  it.each([
    ['no definition at all', undefined],
    ['a definition with nothing this session acts on', { requirements: { cpu: 2 } }],
    ['an empty variable map', { env: {} }],
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
  it('does not read the topic when there is no entitlement', async () => {
    resolveSandboxStorageClaim.mockResolvedValue(null);

    await expect(resolve()).resolves.toEqual({ claim: null, mode: 'ephemeral' });
    expect(findById).not.toHaveBeenCalled();
  });

  // The claim is independent of the mode: the workspace exists whether or not
  // THIS topic writes to it, and the file browser reads it from an ephemeral
  // topic just as well.
  it('keeps the claim on an ephemeral topic but drops the instance', async () => {
    for (const metadata of [{}, { sandboxInstanceId: INSTANCE_ID, sandboxMode: 'ephemeral' }]) {
      findById.mockResolvedValue({ metadata });
      await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'ephemeral' });
    }
  });

  // A persistent topic that never chose one runs at the workspace root under
  // the default environment, which is a working session — just not a named one.
  it('runs at the workspace root when no instance is chosen', async () => {
    findById.mockResolvedValue({ metadata: { sandboxMode: 'persistent' } });

    await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'persistent' });
    expect(findInstanceById).not.toHaveBeenCalled();
  });

  // Deleted, or never this member's — the model answers the same for both.
  // Failing the call instead would leave the topic unable to run at all until
  // someone edited a database row.
  it('falls back to the default when the stored instance no longer resolves', async () => {
    findInstanceById.mockResolvedValue(undefined);

    await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'persistent' });
  });

  // The whole instance goes, not just the directory. Running its packages at
  // the workspace root would put one instance's files under another's
  // captured state — silently, which is the failure worth preventing.
  it('drops the whole instance when its directory would not survive the fence', async () => {
    findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: '../other-user' });

    await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'persistent' });
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
      metadata: { sandboxInstanceId: INSTANCE_ID, sandboxMode: 'persistent' },
    });
    getAgentVisibility.mockResolvedValue('public');
    findInstanceById.mockResolvedValue(undefined);

    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
      claim: CLAIM,
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

  // A workspace root is shared by every member and holds every instance's
  // directory, so no run lands there by falling back — deleted instance,
  // unusable directory or none chosen alike. A personal root is the owner's
  // own, which is why the tests above still expect it there.
  it('never falls back to the shared root inside a workspace', async () => {
    findInstanceById.mockResolvedValue(undefined);
    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
      claim: CLAIM,
      mode: 'ephemeral',
    });

    findInstanceById.mockResolvedValue({ id: INSTANCE_ID, workingDirectory: '../other-user' });
    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
      claim: CLAIM,
      mode: 'ephemeral',
    });

    findById.mockResolvedValue({ metadata: { sandboxMode: 'persistent' } });
    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toEqual({
      claim: CLAIM,
      mode: 'ephemeral',
    });
  });

  // Personal agents default to 'public' without meaning it, and every
  // personal environment is the owner's own — so no agent read, no narrowing.
  it('does not narrow by agent visibility in personal mode', async () => {
    findById.mockResolvedValue({
      agentId: 'agent-personal',
      metadata: { sandboxInstanceId: INSTANCE_ID, sandboxMode: 'persistent' },
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

    await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'ephemeral' });
  });

  it('degrades to ephemeral when the instance lookup throws', async () => {
    findInstanceById.mockRejectedValue(new Error('db down'));

    await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'ephemeral' });
  });

  it('needs no topic to resolve the entitlement', async () => {
    await expect(resolve({ topicId: undefined })).resolves.toEqual({
      claim: CLAIM,
      mode: 'ephemeral',
    });
    expect(findById).not.toHaveBeenCalled();
  });
});
