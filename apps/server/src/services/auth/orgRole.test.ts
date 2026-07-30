import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMemberRole: vi.fn(),
  isPlatformAdmin: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/database/models/organization', () => ({
  OrganizationModel: class {
    getMemberRole = mocks.getMemberRole;
    isPlatformAdmin = mocks.isPlatformAdmin;
  },
}));

// Import after mocks so vi.mock factories are registered first
const { getCurrentOrgRole, isPlatformAdmin, requiresPhoneVerification } = await import('./orgRole');

describe('orgRole helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentOrgRole delegates to OrganizationModel', async () => {
    mocks.getMemberRole.mockResolvedValue('admin');
    await expect(getCurrentOrgRole('user_1', 'org_1')).resolves.toBe('admin');
    expect(mocks.getMemberRole).toHaveBeenCalledWith('user_1', 'org_1');
  });

  it('isPlatformAdmin delegates to OrganizationModel', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(true);
    await expect(isPlatformAdmin('user_1')).resolves.toBe(true);
  });

  describe('requiresPhoneVerification', () => {
    it('skips when phone is already verified', async () => {
      await expect(
        requiresPhoneVerification({
          phoneNumberVerified: true,
          userId: 'user_1',
        }),
      ).resolves.toBe(false);
    });

    it('requires verify for independent buyers (no org)', async () => {
      await expect(
        requiresPhoneVerification({
          phoneNumberVerified: false,
          userId: 'user_1',
        }),
      ).resolves.toBe(true);
    });

    it('skips for invited org members', async () => {
      mocks.getMemberRole.mockResolvedValue('member');
      await expect(
        requiresPhoneVerification({
          orgId: 'org_1',
          phoneNumberVerified: false,
          userId: 'user_1',
        }),
      ).resolves.toBe(false);
    });

    it('requires verify for org owners', async () => {
      mocks.getMemberRole.mockResolvedValue('owner');
      await expect(
        requiresPhoneVerification({
          orgId: 'org_1',
          phoneNumberVerified: false,
          userId: 'user_1',
        }),
      ).resolves.toBe(true);
    });
  });
});
