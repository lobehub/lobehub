// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { users } from '@/database/schemas';
import { startOAuthMcpServer } from '@/libs/mcp/__tests__/fixtures/oauthMcpServer';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';

import { callConnectorToolById } from '../exec';
import { resolveLinkIdentity } from '../identity';
import { loadConnectorLinksMap } from '../links';
import {
  buildAuthorizationUrl,
  discoverConnectorOAuth,
  exchangeConnectorCode,
  resolveConnectorClient,
  resolveConnectorOAuthScopes,
  toClientInformation,
} from '../oauth';
import { syncConnectorToolsById } from '../sync';
import { tokensToCredentials } from '../tokens';

vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: async () => false }));
vi.mock('../refresh', () => ({
  scheduleStaleConnectorToolsRefresh: () => {},
  buildLastSyncedAtMap: () => new Map(),
}));
const db = await getTestDB();
const vault = {
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => ({ plaintext: s.replace(/^enc:/, '') }),
};
const model = new ConnectorModel(db, 'account-e2e', undefined, vault);
const linkModel = model.getLinkModel();
const toolModel = new ConnectorToolModel(db, 'account-e2e');
const ctx = {
  connectorModel: model,
  connectorLinkModel: linkModel,
  connectorToolModel: toolModel,
  agentModel: { existsById: async () => true },
  userId: 'account-e2e',
};
beforeAll(() => {
  vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  await db.delete(users);
});

describe('OAuth account routing over real HTTP and database', () => {
  it.each(['idtoken', 'userinfo', 'none'] as const)(
    'authorizes and routes two accounts (%s)',
    async (variant) => {
      const fixture = await startOAuthMcpServer(variant);
      try {
        await db.insert(users).values({ id: 'account-e2e' });
        const row = await model.create({
          identifier: 'account-fixture',
          name: 'Accounts',
          sourceType: 'custom',
          mcpConnectionType: 'http',
          mcpServerUrl: `${fixture.base}/mcp`,
          status: 'disconnected',
        });
        const discovery = await discoverConnectorOAuth(`${fixture.base}/mcp`);
        const scopes = resolveConnectorOAuthScopes({ discovery });
        const redirectUri = 'http://localhost/callback';
        const client = await resolveConnectorClient({
          authorizationServerUrl: discovery.authorizationServerUrl,
          existing: { scheme: 'dcr' },
          metadata: discovery.metadata,
          redirectUri,
          scopes,
        });
        const oidc = { ...client, issuer: discovery.authorizationServerUrl, redirectUri, scopes };
        await model.update(row.id, { oidcConfig: oidc });
        const authorize = async (account: string) => {
          const { authorizationUrl, codeVerifier } = await buildAuthorizationUrl({
            authorizationServerUrl: fixture.base,
            clientInformation: toClientInformation(oidc),
            metadata: discovery.metadata,
            redirectUri,
            scopes,
            state: 'fixture-state',
            prompt: 'select_account',
          });
          const url = new URL(authorizationUrl);
          url.searchParams.set('account', account);
          const response = await fetch(url, { redirect: 'manual' });
          const callback = new URL(response.headers.get('location')!);
          const { tokens } = await exchangeConnectorCode({
            authorizationCode: callback.searchParams.get('code')!,
            authorizationServerUrl: fixture.base,
            clientInformation: toClientInformation(oidc),
            codeVerifier,
            metadata: discovery.metadata,
            redirectUri,
            iss: fixture.base,
          });
          const { credentials, tokenExpiresAt } = tokensToCredentials(tokens);
          if (credentials.type !== 'oauth2') throw new Error('Expected OAuth credentials');
          return linkModel.saveAuthorization(row.id, {
            authorizerId: 'account-e2e',
            target: { kind: 'new' },
            credentials,
            tokenExpiresAt,
            identity: await resolveLinkIdentity({ tokens, metadata: discovery.metadata }),
          });
        };
        const alice = await authorize('alice');
        await syncConnectorToolsById(row.id, ctx, { linkId: alice.linkId });
        let connector = (await model.findById(row.id))!;
        let links = (await loadConnectorLinksMap([connector], ctx)).get(row.id)!;
        const tools = await toolModel.queryByConnector(row.id);
        expect(
          buildConnectorManifests([{ ...connector, links }], tools)[0].api[0].parameters.required,
        ).toBeUndefined();
        const bob = await authorize('bob');
        connector = (await model.findById(row.id))!;
        links = (await loadConnectorLinksMap([connector], ctx)).get(row.id)!;
        expect(links.map((link) => link.name)).toEqual(
          variant === 'none' ? ['Default', 'Account 2'] : ['alice@example.com', 'bob@example.com'],
        );
        const manifest = buildConnectorManifests([{ ...connector, links }], tools)[0];
        expect(manifest.api.every((tool) => tool.parameters.required?.includes('link_id'))).toBe(
          true,
        );
        expect(
          (manifest as unknown as { mcpParams: { auth?: unknown } }).mcpParams.auth,
        ).toBeUndefined();
        if (variant !== 'none') {
          expect((await authorize('bob')).outcome).toBe('matchedExisting');
          expect(await linkModel.listByConnectorIds([row.id])).toHaveLength(2);
        }
        await callConnectorToolById(
          {
            identifier: row.identifier,
            toolName: 'echo_args',
            args: JSON.stringify({ link_id: bob.linkId, x: 1 }),
          },
          ctx,
        );
        expect(fixture.requests.at(-1)).toMatchObject({
          authorization: expect.stringMatching(/^Bearer tok-bob-/),
          arguments: { x: 1 },
        });
        expect(fixture.requests.at(-1)!.arguments).not.toHaveProperty('link_id');
        expect(
          await callConnectorToolById({ identifier: row.identifier, toolName: 'whoami' }, ctx),
        ).toMatchObject({
          success: false,
          content: expect.stringContaining('link_id is required'),
        });
        expect(
          await callConnectorToolById(
            { identifier: row.identifier, toolName: 'whoami', args: '{"link_id":"invalid"}' },
            ctx,
          ),
        ).toMatchObject({ success: false, content: expect.stringContaining('no longer exists') });
        await linkModel.updateCredentials(
          bob.linkId,
          { ...(await linkModel.findById(bob.linkId))!.credentials, expiresAt: 1 },
          new Date(1),
        );
        await callConnectorToolById(
          {
            identifier: row.identifier,
            toolName: 'whoami',
            args: JSON.stringify({ link_id: bob.linkId }),
          },
          ctx,
        );
        expect(fixture.refreshes).toHaveLength(1);
        expect(fixture.refreshes[0]).toMatch(/^refresh-bob-/);
        const legacy = await model.create({
          identifier: 'legacy',
          name: 'Legacy',
          sourceType: 'custom',
          status: 'connected',
          credentials: JSON.stringify({ type: 'oauth2', accessToken: 'tok-alice-legacy' }),
        });
        await loadConnectorLinksMap([(await model.findById(legacy.id))!], ctx);
        expect((await linkModel.listByConnectorIds([legacy.id]))[0].name).toBe('Default');
        expect((await model.findById(legacy.id))!.credentials).toBeNull();
      } finally {
        await fixture.close();
      }
    },
    120_000,
  );
});
