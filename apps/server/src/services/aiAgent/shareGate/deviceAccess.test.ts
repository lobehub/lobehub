import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { resolveShareVisitorDeviceAccess } from './deviceAccess';

vi.mock('@/database/models/user', () => ({ UserModel: { findById: vi.fn() } }));

const db = {} as LobeChatDatabase;
const findById = vi.mocked(UserModel.findById);

const visitor = (email: string | null, emailVerified: boolean) =>
  findById.mockResolvedValue({ email, emailVerified, id: 'visitor-1' } as any);

describe('resolveShareVisitorDeviceAccess', () => {
  beforeEach(() => findById.mockReset());

  it('denies by default and under `none`', async () => {
    expect(await resolveShareVisitorDeviceAccess(db, {}, 'visitor-1')).toBe(false);
    expect(await resolveShareVisitorDeviceAccess(db, { deviceAccess: 'none' }, 'visitor-1')).toBe(
      false,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('grants every visitor under `all` without a user lookup', async () => {
    expect(await resolveShareVisitorDeviceAccess(db, { deviceAccess: 'all' }, 'visitor-1')).toBe(
      true,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('grants a listed visitor whose email is verified, case-insensitively', async () => {
    visitor('Alice@Example.com', true);
    expect(
      await resolveShareVisitorDeviceAccess(
        db,
        { deviceAccess: 'allowlist', deviceAllowEmails: ['alice@example.com'] },
        'visitor-1',
      ),
    ).toBe(true);
  });

  it('denies a listed email that is not verified', async () => {
    visitor('alice@example.com', false);
    expect(
      await resolveShareVisitorDeviceAccess(
        db,
        { deviceAccess: 'allowlist', deviceAllowEmails: ['alice@example.com'] },
        'visitor-1',
      ),
    ).toBe(false);
  });

  it('denies an unlisted visitor and an empty allowlist', async () => {
    visitor('bob@example.com', true);
    expect(
      await resolveShareVisitorDeviceAccess(
        db,
        { deviceAccess: 'allowlist', deviceAllowEmails: ['alice@example.com'] },
        'visitor-1',
      ),
    ).toBe(false);
    expect(
      await resolveShareVisitorDeviceAccess(
        db,
        { deviceAccess: 'allowlist', deviceAllowEmails: [] },
        'visitor-1',
      ),
    ).toBe(false);
  });
});
