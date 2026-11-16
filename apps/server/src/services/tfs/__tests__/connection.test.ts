// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmIdentityModel } from '@/database/models/scm';
import { scmIdentities, users } from '@/database/schemas';

import { TfsClient } from '../client';
import { TfsConnectionService } from '../connection';
import { validateTfsSources } from '../source';

const db = await getTestDB();
const userId = 'tfs-connection-a';
const otherUserId = 'tfs-connection-b';
const collection = 'https://tfs.example.com/Collection';
const credentials = {
  authType: 'ntlm' as const,
  secret: 'test-only-secret',
  username: 'DOMAIN\\a',
};
const service = new TfsConnectionService(db, userId);
const other = new TfsConnectionService(db, otherUserId);

beforeEach(async () => {
  vi.stubEnv('TFS_COLLECTION_URL', collection);
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 42).toString('base64'));
  vi.stubEnv('KEY_VAULTS_FALLBACK_SECRET', '');
  vi.spyOn(TfsClient.prototype, 'identity').mockResolvedValue({
    id: 'verified-id',
    login: 'verified-a',
  });
  await db
    .insert(users)
    .values([{ id: userId }, { id: otherUserId }])
    .onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('personal TFS connections', () => {
  it('encrypts credentials and never returns them in status', async () => {
    const status = await service.connect(credentials);
    expect(status).toMatchObject({ hasBinding: true, identity: { login: 'verified-a' } });
    expect(JSON.stringify(status)).not.toContain(credentials.secret);
    const [stored] = await db.select().from(scmIdentities).where(eq(scmIdentities.userId, userId));
    expect(stored.credentials).not.toContain(credentials.secret);
    await expect(service.credentials()).resolves.toEqual(credentials);
    await expect(other.credentials()).rejects.toThrow('TFS_NOT_CONNECTED');
  });

  it('rejects binding the verified external identity to another user', async () => {
    await service.connect(credentials);
    await expect(other.connect(credentials)).rejects.toThrow('TFS_IDENTITY_TAKEN');
    await other.disconnect();
    expect((await service.status()).hasBinding).toBe(true);
    await expect(service.credentials()).resolves.toEqual(credentials);
  });

  it('requires disconnect before switching accounts and permits updating the same account', async () => {
    await service.connect(credentials);
    await service.connect({ ...credentials, secret: 'updated-test-secret' });
    await expect(service.credentials()).resolves.toMatchObject({ secret: 'updated-test-secret' });
    vi.mocked(TfsClient.prototype.identity).mockResolvedValue({ id: 'second-id', login: 'second' });
    await expect(service.connect(credentials)).rejects.toThrow('TFS_DISCONNECT_FIRST');
    await service.disconnect();
    await expect(service.connect(credentials)).resolves.toMatchObject({
      identity: { login: 'second' },
    });
  });

  it('keeps old bindings removable after the administrator changes or removes the collection', async () => {
    await service.connect(credentials);
    vi.stubEnv('TFS_COLLECTION_URL', collection + '-new');
    await expect(service.status()).resolves.toMatchObject({ hasBinding: true, identity: null });
    await expect(service.credentials()).rejects.toThrow('TFS_NOT_CONNECTED');
    vi.stubEnv('TFS_COLLECTION_URL', '');
    await expect(service.status()).resolves.toMatchObject({ configured: false, hasBinding: true });
    await service.disconnect();
    expect((await service.status()).hasBinding).toBe(false);
  });

  it('checks each caller and does not borrow another user’s identity for a shared source', async () => {
    await service.connect(credentials);
    const resolve = vi
      .spyOn(TfsClient.prototype, 'resolveRepository')
      .mockRejectedValue(new Error('denied'));
    const sources = [{ kind: 'git', url: collection + '/Project/_git/Repository' }];
    await expect(validateTfsSources(db, otherUserId, sources)).rejects.toThrow('TFS_NOT_CONNECTED');
    expect(resolve).not.toHaveBeenCalled();
    await expect(validateTfsSources(db, userId, sources)).rejects.toThrow('denied');
    await expect(
      validateTfsSources(db, userId, [{ kind: 'git', url: 'https://other/Collection/P/_git/R' }]),
    ).rejects.toThrow('TFS_INVALID_REPOSITORY_URL');
    await expect(
      validateTfsSources(db, otherUserId, [{ kind: 'git', url: 'https://github.com/o/r' }]),
    ).resolves.toBeUndefined();
  });

  it('refuses to store credentials when encryption is not configured', async () => {
    vi.stubEnv('KEY_VAULTS_SECRET', '');
    await expect(service.connect(credentials)).rejects.toThrow('KEY_VAULTS_SECRET');
    expect(await ScmIdentityModel.findByUser(db, 'tfs', userId)).toBeNull();
  });
});
