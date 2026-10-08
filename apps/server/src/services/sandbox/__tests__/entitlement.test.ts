import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSandboxStorageEntitlement = vi.fn();
const getUserPreference = vi.fn();

vi.mock('@/business/server/sandboxStorage', () => ({
  resolveSandboxStorageEntitlement: (...args: unknown[]) =>
    resolveSandboxStorageEntitlement(...args),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserPreference };
  }),
}));

const { resolveSandboxStorageClaim } = await import('../entitlement');

const serverDB = {} as LobeChatDatabase;

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveSandboxStorageClaim({
    isShareVisitorRun: false,
    serverDB,
    userId: 'user_1',
    ...overrides,
  });

describe('resolveSandboxStorageClaim', () => {
  beforeEach(() => {
    resolveSandboxStorageEntitlement.mockReset();
    getUserPreference.mockReset();
    getUserPreference.mockResolvedValue({ lab: { enablePersistentSandbox: true } });
    resolveSandboxStorageEntitlement.mockResolvedValue({ quotaBytes: 2048 });
  });

  it('pairs the derived key with the plan quota', async () => {
    await expect(resolve()).resolves.toEqual({ key: 'ws-user_1', quotaBytes: 2048 });
  });

  it('passes the overage licence through, and only when granted', async () => {
    // The execution plane is told the answer, never the inputs — and absent
    // has to read as no, so a deployment that says nothing cannot bill anyone.
    resolveSandboxStorageEntitlement.mockResolvedValue({
      overageAllowed: true,
      quotaBytes: 2048,
    });

    await expect(
      resolveSandboxStorageClaim({ isShareVisitorRun: false, serverDB: {} as any, userId: 'u1' }),
    ).resolves.toMatchObject({ overageAllowed: true });

    resolveSandboxStorageEntitlement.mockResolvedValue({ quotaBytes: 2048 });

    expect(
      await resolveSandboxStorageClaim({
        isShareVisitorRun: false,
        serverDB: {} as any,
        userId: 'u1',
      }),
    ).not.toHaveProperty('overageAllowed');
  });

  it('judges an organization run by its workspace', async () => {
    resolveSandboxStorageEntitlement.mockResolvedValue({ quotaBytes: 4096 });

    await expect(resolve({ workspaceId: 'wsp_42' })).resolves.toEqual({
      key: 'ws-org-wsp_42',
      quotaBytes: 4096,
    });
    expect(resolveSandboxStorageEntitlement).toHaveBeenCalledWith({
      userId: 'user_1',
      workspaceId: 'wsp_42',
    });
  });

  // The lab flag is the whole feature's gate: without a claim the execution
  // plane routes to the ephemeral sandbox whatever mode the request asks for.
  it('issues nothing until the lab experiment is switched on', async () => {
    for (const lab of [undefined, {}, { enablePersistentSandbox: false }]) {
      getUserPreference.mockResolvedValue(lab === undefined ? undefined : { lab });
      await expect(resolve()).resolves.toBeNull();
    }

    expect(resolveSandboxStorageEntitlement).not.toHaveBeenCalled();
  });

  // A share visitor's run executes under the CREATOR's identity, so every input
  // here describes the creator. A claim would hand the visitor the creator's
  // working directory.
  it('issues nothing for a share-visitor run, without reading the creator at all', async () => {
    await expect(resolve({ isShareVisitorRun: true })).resolves.toBeNull();

    expect(getUserPreference).not.toHaveBeenCalled();
    expect(resolveSandboxStorageEntitlement).not.toHaveBeenCalled();
  });

  it('is null for a plan with no persistence', async () => {
    resolveSandboxStorageEntitlement.mockResolvedValue(null);

    await expect(resolve()).resolves.toBeNull();
  });

  // A key with no quota is not an entitlement. The receiving end rejects the
  // WHOLE token on a malformed claim, so a zero or fractional quota must never
  // leave here.
  it('rejects a quota that is not a usable size', async () => {
    for (const quota of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, '2048']) {
      resolveSandboxStorageEntitlement.mockResolvedValue(quota);
      await expect(resolve()).resolves.toBeNull();
    }
  });

  // An unsafe id costs persistence, not the whole request.
  it('skips both lookups when no safe key can be derived', async () => {
    await expect(resolve({ userId: '../etc/passwd' })).resolves.toBeNull();

    expect(getUserPreference).not.toHaveBeenCalled();
    expect(resolveSandboxStorageEntitlement).not.toHaveBeenCalled();
  });

  // Losing either lookup must degrade to an ephemeral sandbox — the behaviour
  // every session has today — not fail the tool call.
  it('degrades to no entitlement when a lookup throws', async () => {
    getUserPreference.mockRejectedValue(new Error('db down'));
    await expect(resolve()).resolves.toBeNull();

    getUserPreference.mockResolvedValue({ lab: { enablePersistentSandbox: true } });
    resolveSandboxStorageEntitlement.mockRejectedValue(new Error('entitlement lookup failed'));
    await expect(resolve()).resolves.toBeNull();
  });
});
