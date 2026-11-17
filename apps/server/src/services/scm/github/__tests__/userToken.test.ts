// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmIdentityModel } from '@/database/models/scm';
import { scmIdentities, users } from '@/database/schemas';

import { GithubUserTokenService } from '../userToken';

const db = await getTestDB();
const userId = 'user-token-owner';
const now = new Date('2026-11-17T10:00:00Z');
const passthrough = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
  encrypt: async (plaintext: string) => plaintext,
};

const store = (tokenExpiresAt: Date | null, refreshToken: string | null = 'ghr_old') =>
  ScmIdentityModel.upsert(db, {
    credentials: { accessToken: 'ghu_old', ...(refreshToken ? { refreshToken } : {}) },
    externalLogin: 'octocat',
    externalUserId: '583231',
    metadata: { name: 'The Octocat' },
    provider: 'github',
    tokenExpiresAt,
    userId,
  });

const refresh = vi.fn();
const service = () =>
  new GithubUserTokenService(db, { gateKeeper: async () => passthrough, now: () => now, refresh });

beforeEach(async () => {
  vi.clearAllMocks();
  await db.insert(users).values({ id: userId });
  refresh.mockResolvedValue({
    accessToken: 'ghu_fresh',
    expiresAt: '2026-11-17T18:00:00.000Z',
    refreshToken: 'ghr_fresh',
    refreshTokenExpiresAt: '2027-05-17T10:00:00.000Z',
  });
});

afterEach(async () => {
  await db.delete(scmIdentities);
  await db.delete(users);
});

describe('GithubUserTokenService.getFreshToken', () => {
  it('returns a token that is still valid without refreshing it', async () => {
    await store(new Date('2026-11-17T15:00:00Z'));

    await expect(service().getFreshToken(userId)).resolves.toEqual({
      expiresAt: new Date('2026-11-17T15:00:00Z'),
      gitEmail: '583231+octocat@users.noreply.github.com',
      gitName: 'The Octocat',
      login: 'octocat',
      ok: true,
      token: 'ghu_old',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes a token that is about to expire and stores the rotated pair', async () => {
    await store(new Date('2026-11-17T10:05:00Z'));

    await expect(service().getFreshToken(userId)).resolves.toMatchObject({
      expiresAt: new Date('2026-11-17T18:00:00.000Z'),
      ok: true,
      token: 'ghu_fresh',
    });
    expect(refresh).toHaveBeenCalledWith('ghr_old');

    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity?.credentials).toMatchObject({
      accessToken: 'ghu_fresh',
      refreshToken: 'ghr_fresh',
    });
  });

  it('refreshes once when two runs ask at the same time', async () => {
    await store(new Date('2026-11-17T09:00:00Z'));
    const tokens = service();

    const [first, second] = await Promise.all([
      tokens.getFreshToken(userId),
      tokens.getFreshToken(userId),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ token: 'ghu_fresh' });
    expect(second).toMatchObject({ token: 'ghu_fresh' });
  });

  it('asks a user without an identity to authorize', async () => {
    await expect(service().getFreshToken(userId)).resolves.toEqual({
      ok: false,
      reason: 'not_authorized',
    });
  });

  it('asks for a new authorization when the token never expires', async () => {
    await store(null);

    await expect(service().getFreshToken(userId)).resolves.toEqual({
      ok: false,
      reason: 'reauthorize',
    });
  });

  it('drops the token and asks for a new authorization when GitHub rejects the refresh', async () => {
    await store(new Date('2026-11-17T09:00:00Z'));
    refresh.mockRejectedValue(Object.assign(new Error('bad_refresh_token'), { status: 400 }));

    await expect(service().getFreshToken(userId)).resolves.toEqual({
      ok: false,
      reason: 'reauthorize',
    });

    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity).toMatchObject({ credentials: null, externalLogin: 'octocat' });
  });

  it('keeps the stored token when GitHub rate-limits the refresh', async () => {
    await store(new Date('2026-11-17T09:00:00Z'));
    refresh.mockRejectedValue(Object.assign(new Error('API rate limit exceeded'), { status: 403 }));

    await expect(service().getFreshToken(userId)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity?.credentials).toMatchObject({ accessToken: 'ghu_old' });
  });

  it('reports the service as unavailable when GitHub cannot be reached', async () => {
    await store(new Date('2026-11-17T09:00:00Z'));
    refresh.mockRejectedValue(new Error('fetch failed'));

    await expect(service().getFreshToken(userId)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity?.credentials).toMatchObject({ accessToken: 'ghu_old' });
  });
});

describe('GithubUserTokenService.rotate', () => {
  it('refreshes even a valid token so the one handed out stops working', async () => {
    await store(new Date('2026-11-17T15:00:00Z'));

    await service().rotate(userId);

    expect(refresh).toHaveBeenCalledWith('ghr_old');
    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity?.credentials).toMatchObject({ accessToken: 'ghu_fresh' });
  });

  it('does nothing for a user without a refresh token', async () => {
    await store(new Date('2026-11-17T15:00:00Z'), null);

    await service().rotate(userId);

    expect(refresh).not.toHaveBeenCalled();
  });
});
