/**
 * @vitest-environment node
 */
import Provider from 'oidc-provider';
import { describe, expect, it, vi } from 'vitest';

import { stampClientLastUsed } from './clientLastUsed';

const createDb = ({ rejects = false } = {}) => {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => (rejects ? Promise.reject(new Error('db down')) : Promise.resolve())),
  };
  const db = { update: vi.fn(() => chain) };
  return { chain, db };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('stampClientLastUsed', () => {
  it('stamps a user-created (lca_) client', async () => {
    const { chain, db } = createDb();

    stampClientLastUsed(db as any, 'lca_client_1');
    await flush();

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(chain.set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
  });

  it('ignores static first-party clients and missing ids', () => {
    const { db } = createDb();

    stampClientLastUsed(db as any, 'lobehub-cli');
    stampClientLastUsed(db as any, undefined);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('swallows a failed update', async () => {
    const { db } = createDb({ rejects: true });

    expect(() => stampClientLastUsed(db as any, 'lca_client_2')).not.toThrow();
    await flush();
  });
});

/**
 * Why the provider listens to `access_token.issued`: a JWT access token, which
 * every token for the API audience is, is never written through the adapter,
 * so the adapter's AccessToken upsert alone left web apps "never used".
 */
describe('oidc-provider JWT access tokens', () => {
  it('emit access_token.issued without touching the adapter', async () => {
    const upsert = vi.fn();
    class SpyAdapter {
      upsert = upsert;
      find = vi.fn();
      findByUid = vi.fn();
      findByUserCode = vi.fn();
      consume = vi.fn();
      destroy = vi.fn();
      revokeByGrantId = vi.fn();
    }
    const provider = new Provider('https://example.com/oidc', {
      adapter: SpyAdapter as any,
      clients: [
        {
          client_id: 'lca_web',
          client_secret: 'secret',
          redirect_uris: ['https://app.example.com/callback'],
        },
      ],
    });
    const issued = vi.fn();
    provider.on('access_token.issued', issued);

    const client = await provider.Client.find('lca_web');
    const token = new provider.AccessToken({
      accountId: 'user-1',
      client,
      grantId: 'grant-1',
      resourceServer: { accessTokenFormat: 'jwt', audience: 'urn:lobehub:chat' },
    } as any);
    await token.save();

    expect(upsert).not.toHaveBeenCalled();
    expect(issued).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'lca_web' }));
  });
});
