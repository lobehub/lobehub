// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';

import { userRouter } from '../user';

vi.mock('@/database/models/user');
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/server/modules/S3');

describe('user.setWorktreeModeDir', () => {
  const ctx = { userId: 'user-1' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores one directory switch through the locked model write', async () => {
    const setWorktreeModeDir = vi.fn().mockResolvedValue(['dev::/code/a']);
    vi.mocked(UserModel).mockImplementation(function () {
      return { setWorktreeModeDir } as any;
    });

    await expect(
      userRouter.createCaller(ctx).setWorktreeModeDir({ enabled: true, key: 'dev::/code/a' }),
    ).resolves.toEqual(['dev::/code/a']);
    expect(setWorktreeModeDir).toHaveBeenCalledWith('dev::/code/a', true);
  });

  it('rejects an empty key', async () => {
    await expect(
      userRouter.createCaller(ctx).setWorktreeModeDir({ enabled: false, key: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
