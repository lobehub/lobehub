import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findInstanceById: vi.fn(),
  resolveSandboxWorkspaceClaim: vi.fn(),
}));

const { findById, findInstanceById, resolveSandboxWorkspaceClaim } = mocks;

vi.mock('../entitlement', () => ({
  resolveSandboxWorkspaceClaim: mocks.resolveSandboxWorkspaceClaim,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findById };
  }),
}));

vi.mock('@/database/models/environmentInstance', () => ({
  EnvironmentInstanceModel: vi.fn(function () {
    return { findById: mocks.findInstanceById };
  }),
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
    resolveSandboxWorkspaceClaim.mockReset();
    findById.mockReset();
    findInstanceById.mockReset();
    resolveSandboxWorkspaceClaim.mockResolvedValue(CLAIM);
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

  // Without an entitlement the execution plane routes to the ephemeral sandbox
  // whatever the request says, so reading the topic buys nothing. Leaving the
  // chosen instance untouched on the topic is what lets a resubscription resume
  // exactly where the user left off.
  it('does not read the topic when there is no entitlement', async () => {
    resolveSandboxWorkspaceClaim.mockResolvedValue(null);

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

  it('stays ephemeral for a share-visitor run', async () => {
    resolveSandboxWorkspaceClaim.mockResolvedValue(null);

    await expect(resolve({ isShareVisitorRun: true })).resolves.toEqual({
      claim: null,
      mode: 'ephemeral',
    });
    expect(resolveSandboxWorkspaceClaim).toHaveBeenCalledWith(
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
