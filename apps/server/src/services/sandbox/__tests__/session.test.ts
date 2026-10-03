import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  resolveSandboxWorkspaceClaim: vi.fn(),
}));

const { findById, resolveSandboxWorkspaceClaim } = mocks;

vi.mock('../entitlement', () => ({
  resolveSandboxWorkspaceClaim: mocks.resolveSandboxWorkspaceClaim,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findById };
  }),
}));

const { resolveSandboxSessionConfig } = await import('../session');

const serverDB = {} as LobeChatDatabase;
const CLAIM = { key: 'ws-user_1', quotaBytes: 2048 };

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
    resolveSandboxWorkspaceClaim.mockResolvedValue(CLAIM);
    findById.mockResolvedValue({
      metadata: { sandboxCwd: 'projects/atlas', sandboxMode: 'persistent' },
    });
  });

  it('carries the claim, the mode and the chosen directory', async () => {
    await expect(resolve()).resolves.toEqual({
      claim: CLAIM,
      cwd: 'projects/atlas',
      mode: 'persistent',
    });
  });

  // Without an entitlement the execution plane routes to the ephemeral sandbox
  // whatever the request says, so reading the topic buys nothing. Leaving
  // `sandboxCwd` untouched on the topic is what lets a resubscription resume
  // exactly where the user left off.
  it('does not read the topic when there is no entitlement', async () => {
    resolveSandboxWorkspaceClaim.mockResolvedValue(null);

    await expect(resolve()).resolves.toEqual({ claim: null, mode: 'ephemeral' });
    expect(findById).not.toHaveBeenCalled();
  });

  // The claim is independent of the mode: the workspace exists whether or not
  // THIS topic writes to it, and the file browser reads it from an ephemeral
  // topic just as well.
  it('keeps the claim on an ephemeral topic but drops the directory', async () => {
    for (const metadata of [{}, { sandboxMode: 'ephemeral', sandboxCwd: 'projects/atlas' }]) {
      findById.mockResolvedValue({ metadata });
      await expect(resolve()).resolves.toEqual({ claim: CLAIM, mode: 'ephemeral' });
    }
  });

  it('drops a directory that would not survive the fence', async () => {
    findById.mockResolvedValue({
      metadata: { sandboxCwd: '../other-user', sandboxMode: 'persistent' },
    });

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

  it('needs no topic to resolve the entitlement', async () => {
    await expect(resolve({ topicId: undefined })).resolves.toEqual({
      claim: CLAIM,
      mode: 'ephemeral',
    });
    expect(findById).not.toHaveBeenCalled();
  });
});
