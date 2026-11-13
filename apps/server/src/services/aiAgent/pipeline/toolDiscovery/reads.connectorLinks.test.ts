// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { ConnectorAccountRepo } from '@/database/repositories/connectorAccount';
import { users } from '@/database/schemas';
import { startOAuthMcpServer } from '@/libs/mcp/__tests__/fixtures/oauthMcpServer';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';

import { startToolReads } from './reads';

const vault = vi.hoisted(() => ({
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => ({ plaintext: s.replace(/^enc:/, '') }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => vault },
}));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));
const db = await getTestDB();
const model = new ConnectorModel(db, 'read-links', undefined, vault);
const toolModel = new ConnectorToolModel(db, 'read-links');
afterEach(async () => {
  await db.delete(users);
  vi.unstubAllEnvs();
});

describe('server discovery account credentials and visitor privacy', () => {
  it.each([false, true])(
    'keeps multiple tokens out of the run and does not pre-refresh (visitor=%s)',
    async (visitor) => {
      vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
      const fixture = await startOAuthMcpServer();
      try {
        await db.insert(users).values({ id: 'read-links' });
        const row = await model.create({
          identifier: 'multi',
          name: 'Multi',
          sourceType: 'custom',
          isEnabled: true,
          status: 'connected',
          mcpConnectionType: 'http',
          mcpServerUrl: `${fixture.base}/mcp`,
          oidcConfig: { clientId: 'fixture-client', scheme: 'dcr', issuer: fixture.base },
        });
        for (const account of ['alice', 'bob'])
          await new ConnectorAccountRepo(db, 'read-links', undefined, vault).saveAuthorization(
            row.id,
            {
              target: { kind: 'new' },
              authorizerId: 'read-links',
              credentials: {
                type: 'oauth2',
                accessToken: `tok-${account}-expired`,
                refreshToken: `refresh-${account}-test`,
                expiresAt: 1,
              },
              tokenExpiresAt: new Date(1),
              identity: { profile: { email: `${account}@private.example` } },
            },
          );
        await toolModel.upsertMany(row.id, [
          { toolName: 'echo', crudType: 'read', inputSchema: { type: 'object' } },
        ]);
        const reads = startToolReads(
          {
            db,
            userId: 'read-links',
            connectorModel: model,
            connectorToolModel: toolModel,
            pluginModel: { query: async () => [] },
            agentDocumentsService: { hasDocuments: async () => false },
            composioService: { getComposioManifests: async () => [] },
            getMarketService: async () => ({ getLobehubSkillManifests: async () => [] }),
          } as any,
          {
            candidateIds: ['multi'],
            resolvedAgentId: 'agent',
            agentConfig: {},
            isGoalTurn: true,
            topicId: '',
            shareGate: visitor ? {} : undefined,
          } as any,
        );
        const result = await reads.connectors;
        expect(result.connectorsMcp[0].credentials).toBeNull();
        expect(JSON.stringify(result.connectorsMcp)).not.toContain('tok-alice');
        expect(fixture.refreshes).toEqual([]);
        const manifest = buildConnectorManifests(result.connectorsMcp, result.connectorTools)[0];
        expect(manifest.api[0].parameters.required).toContain('link_id');
        expect((manifest as any).mcpParams.auth).toBeUndefined();
        expect(JSON.stringify(manifest)).toContain(visitor ? 'Account 1' : 'alice@private.example');
        if (visitor) expect(JSON.stringify(manifest)).not.toContain('@private.example');
      } finally {
        await fixture.close();
      }
    },
  );
});
