// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorAccountRepo } from '@/database/repositories/connectorAccount';
import { users } from '@/database/schemas';
import { startOAuthMcpServer } from '@/libs/mcp/__tests__/fixtures/oauthMcpServer';
import { ensureFreshLinkToken } from '@/server/services/connector/tokens';

import { connectorRouter } from '../connector';

const vault = vi.hoisted(() => ({
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => ({ plaintext: s.replace(/^enc:/, '') }),
}));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => vault },
}));
const db = await getTestDB();
const model = new ConnectorModel(db, 'links-router', undefined, vault);
const linkModel = model.getLinkModel();
const accountRepo = new ConnectorAccountRepo(db, 'links-router', undefined, vault);
const caller = connectorRouter.createCaller({ userId: 'links-router', serverDB: db } as never);
const credentials = {
  type: 'oauth2' as const,
  accessToken: 'private-token',
  refreshToken: 'private-refresh',
};
const create = async () => {
  const row = await model.create({
    identifier: crypto.randomUUID(),
    name: 'OAuth',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example',
    sourceType: 'custom',
    status: 'connected',
    oidcConfig: {
      scheme: 'dcr',
      clientId: 'resolved-client',
      clientSecret: 'resolved-secret',
      issuer: 'https://as.example',
      scopes: ['tools'],
    },
  });
  const link = await accountRepo.saveAuthorization(row.id, {
    target: { kind: 'new' },
    credentials,
    tokenExpiresAt: null,
    authorizerId: 'links-router',
  });
  return { row, link };
};
beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: 'links-router', fullName: 'Author' });
});
afterEach(async () => {
  await db.delete(users);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('connector account APIs', () => {
  it('preserves a resolved DCR client on ordinary form save and both accounts stay usable', async () => {
    const { row } = await create();
    await accountRepo.saveAuthorization(row.id, {
      target: { kind: 'new' },
      credentials,
      tokenExpiresAt: null,
      authorizerId: 'links-router',
    });
    await caller.update({
      id: row.id,
      patch: {
        name: 'Renamed',
        metadata: { customHeaders: { 'X-Test': 'value' } },
        oidcConfig: { scheme: 'dcr', clientId: undefined },
      },
    });
    expect((await model.findById(row.id))?.oidcConfig).toMatchObject({
      clientId: 'resolved-client',
      clientSecret: 'resolved-secret',
      scopes: ['tools'],
    });
    expect(await linkModel.listByConnectorIds([row.id])).toHaveLength(2);
    await caller.update({ id: row.id, patch: { mcpServerUrl: 'https://different.example' } });
    expect(await linkModel.listByConnectorIds([row.id])).toHaveLength(0);
    expect((await model.findById(row.id))?.oidcConfig).toEqual({ scheme: 'dcr' });
  });
  it('returns safe account summaries and the decrypted auth kind', async () => {
    const { row, link } = await create();
    const result = (await caller.list()).find((c) => c.id === row.id)!;
    expect(result).toMatchObject({
      authKind: 'oauth2',
      links: [{ id: link.linkId, name: 'Default', authorizedByName: 'Author' }],
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('resolved-secret');
    await model.create({
      identifier: 'bearer',
      name: 'Bearer',
      sourceType: 'custom',
      status: 'connected',
      credentials: JSON.stringify({ type: 'bearer', token: 'static' }),
    });
    expect((await caller.list()).find((c) => c.identifier === 'bearer')).toMatchObject({
      authKind: 'bearer',
      links: [],
    });
  });
  it('renames, rejects duplicate names and disconnects only after removing the last account', async () => {
    const { row, link } = await create();
    const second = await accountRepo.saveAuthorization(row.id, {
      target: { kind: 'new' },
      credentials,
      tokenExpiresAt: null,
      authorizerId: 'links-router',
    });
    await expect(
      caller.renameLink({ linkId: second.linkId, name: 'Default' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await caller.renameLink({ linkId: second.linkId, name: 'Work' });
    await caller.deleteLink({ linkId: link.linkId });
    expect((await model.findById(row.id))?.status).toBe('connected');
    await caller.deleteLink({ linkId: second.linkId });
    expect((await model.findById(row.id))?.status).toBe('disconnected');
  });
  it('reports none after an explicit switch away from OAuth without losing the no-account OAuth distinction', async () => {
    const { row, link } = await create();
    await caller.deleteLink({ linkId: link.linkId });
    expect((await caller.list()).find((c) => c.id === row.id)?.authKind).toBe('oauth2');
    await caller.update({ id: row.id, patch: { credentials: null } });
    expect((await caller.list()).find((c) => c.id === row.id)?.authKind).toBe('none');
    expect((await model.findById(row.id))?.oidcConfig).toBeNull();
  });
  it.each([undefined, 'updated-secret'])(
    'merges a same-clientId save without losing resolved OAuth config and refreshes its link (secret=%s)',
    async (clientSecret) => {
      vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
      const fixture = await startOAuthMcpServer();
      try {
        const oidc = {
          scheme: 'pre_registration' as const,
          clientId: 'fixture-client',
          clientSecret: 'stored-secret',
          issuer: fixture.base,
          authorizationEndpoint: `${fixture.base}/authorize`,
          tokenEndpoint: `${fixture.base}/token`,
          registrationEndpoint: `${fixture.base}/register`,
          redirectUri: 'http://localhost/callback',
          scopes: ['tools'],
          tokenEndpointAuthMethod: 'none' as const,
        };
        const row = await model.create({
          identifier: crypto.randomUUID(),
          name: 'Refresh',
          sourceType: 'custom',
          status: 'connected',
          mcpConnectionType: 'http',
          mcpServerUrl: `${fixture.base}/mcp`,
          oidcConfig: oidc,
        });
        const link = await accountRepo.saveAuthorization(row.id, {
          target: { kind: 'new' },
          credentials: {
            type: 'oauth2',
            accessToken: 'expired',
            refreshToken: 'refresh-alice-seed',
            expiresAt: 1,
          },
          tokenExpiresAt: new Date(1),
          authorizerId: 'links-router',
        });
        await caller.update({
          id: row.id,
          patch: {
            oidcConfig: { scheme: 'pre_registration', clientId: oidc.clientId, clientSecret },
          },
        });
        const updated = (await model.findById(row.id))!;
        expect(updated.oidcConfig).toEqual({
          ...oidc,
          clientSecret: clientSecret ?? 'stored-secret',
        });
        const links = await linkModel.listByConnectorIds([row.id]);
        expect(links.map((item) => item.id)).toEqual([link.linkId]);
        const refreshed = await ensureFreshLinkToken(updated, links[0], linkModel, model);
        expect(refreshed.credentials.accessToken).toMatch(/^tok-alice-/);
        expect((await linkModel.findById(link.linkId))?.credentials.accessToken).toBe(
          refreshed.credentials.accessToken,
        );
        expect(fixture.refreshes).toEqual(['refresh-alice-seed']);
      } finally {
        await fixture.close();
      }
    },
  );
});
