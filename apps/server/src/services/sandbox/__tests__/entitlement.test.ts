import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSandboxStorageEntitlement = vi.fn();

vi.mock('@/business/server/sandboxStorage', () => ({
  resolveSandboxStorageEntitlement: (...args: unknown[]) =>
    resolveSandboxStorageEntitlement(...args),
}));

const { resolveSandboxStorageClaim } = await import('../entitlement');

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveSandboxStorageClaim({
    isShareVisitorRun: false,
    userId: 'user_1',
    ...overrides,
  });

describe('resolveSandboxStorageClaim', () => {
  beforeEach(() => {
    resolveSandboxStorageEntitlement.mockReset();
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
      resolveSandboxStorageClaim({ isShareVisitorRun: false, userId: 'u1' }),
    ).resolves.toMatchObject({ overageAllowed: true });

    resolveSandboxStorageEntitlement.mockResolvedValue({ quotaBytes: 2048 });

    expect(
      await resolveSandboxStorageClaim({
        isShareVisitorRun: false,
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

  // The plan is the whole feature's gate: no opt-in stands between an entitled
  // account and its drive, and without a claim the execution plane routes to
  // the ephemeral sandbox whatever mode the request asks for.
  it('is decided by the plan alone, with no opt-in', async () => {
    await expect(resolve()).resolves.toEqual({ key: 'ws-user_1', quotaBytes: 2048 });

    resolveSandboxStorageEntitlement.mockResolvedValue(undefined);
    await expect(resolve()).resolves.toBeNull();
  });

  // A share visitor's run executes under the CREATOR's identity, so every input
  // here describes the creator. A claim would hand the visitor the creator's
  // working directory.
  it('issues nothing for a share-visitor run, without reading the creator at all', async () => {
    await expect(resolve({ isShareVisitorRun: true })).resolves.toBeNull();

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
  it('skips the lookup when no safe key can be derived', async () => {
    await expect(resolve({ userId: '../etc/passwd' })).resolves.toBeNull();

    expect(resolveSandboxStorageEntitlement).not.toHaveBeenCalled();
  });

  // Losing the lookup must degrade to an ephemeral sandbox — the behaviour
  // every free session has — not fail the tool call.
  it('degrades to no entitlement when the lookup throws', async () => {
    resolveSandboxStorageEntitlement.mockRejectedValue(new Error('entitlement lookup failed'));
    await expect(resolve()).resolves.toBeNull();
  });
});
