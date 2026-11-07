// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  listGitBranches: vi.fn(),
  listGitRemoteBranches: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    // Personal-scope caller: the approved-root check reads the personal row;
    // '/repo' stands in for a bound working directory.
    findByDeviceId = vi
      .fn()
      .mockResolvedValue({ defaultCwd: null, workingDirs: [{ path: '/repo' }] });
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    listGitBranches: mocks.listGitBranches,
    listGitRemoteBranches: mocks.listGitRemoteBranches,
  },
}));

/**
 * The branch-list procedures feed replicas that persist what they answer. A
 * device that could not answer must not look like a repository with no
 * branches (`[]`), and the response must stay an array for released clients
 * (no `null`): only a procedure error satisfies both.
 */
describe('device branch-list procedures', () => {
  const caller = deviceRouter.createCaller({ userId: 'user' } as never);
  const input = { deviceId: 'device', path: '/repo' };

  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['listGitBranches', () => caller.listGitBranches(input), mocks.listGitBranches],
    [
      'listGitRemoteBranches',
      () => caller.listGitRemoteBranches(input),
      mocks.listGitRemoteBranches,
    ],
  ] as const)('%s rejects when the device could not answer', async (_name, call, gateway) => {
    gateway.mockResolvedValue(undefined);

    const error = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('BAD_GATEWAY');
  });

  it.each([
    ['listGitBranches', () => caller.listGitBranches(input), mocks.listGitBranches],
    [
      'listGitRemoteBranches',
      () => caller.listGitRemoteBranches(input),
      mocks.listGitRemoteBranches,
    ],
  ] as const)('%s returns an empty answer as an empty array', async (_name, call, gateway) => {
    gateway.mockResolvedValue([]);

    await expect(call()).resolves.toEqual([]);
  });
});
