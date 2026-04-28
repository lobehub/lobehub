import { MarketSDK } from '@lobehub/market-sdk';
import type * as DrizzleMigrator from 'drizzle-orm/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  marketAccounts,
  marketAgentEvents,
  marketAgents,
  marketAgentVersions,
} from '../../../../packages/database/src/schemas/market';
import { createMarketTestFetch, createMarketTrustToken } from '../test-utils';
import type { MarketDatabase } from '../types';

interface DatabaseTestUtils {
  getTestDB: () => Promise<MarketDatabase>;
}

vi.mock('@/config/db', () => ({
  serverDBEnv: {},
}));

// PGlite rejects a prepared statement containing multiple migration commands; split those Drizzle statements in tests only.
vi.mock('drizzle-orm/migrator', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleMigrator>();

  return {
    ...actual,
    readMigrationFiles: (config: Parameters<typeof actual.readMigrationFiles>[0]) =>
      actual.readMigrationFiles(config).map((migration) => ({
        ...migration,
        sql: migration.sql.flatMap((statement) => {
          if (
            !statement.includes('DROP CONSTRAINT IF EXISTS') ||
            !statement.includes('ADD CONSTRAINT')
          ) {
            return statement;
          }

          return statement
            .split(/;\s*\n/)
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => `${part};`);
        }),
      })),
  };
});

const loadDatabaseTestUtils = async (): Promise<DatabaseTestUtils> => {
  const moduleName = ['@lobechat/database', 'test-utils'].join('/');

  return await import(moduleName);
};

const { getTestDB } = await loadDatabaseTestUtils();

describe('Market SDK agent contract', async () => {
  const db: MarketDatabase = await getTestDB();
  let fetchFn: typeof fetch;

  beforeEach(async () => {
    await db.delete(marketAgentEvents);
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);

    fetchFn = await createMarketTestFetch();
    vi.stubGlobal('fetch', fetchFn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates, publishes, reads, counts, and forks agents through the public SDK', async () => {
    const sdk = new MarketSDK({
      baseURL: 'http://market.test',
      trustedClientToken: createMarketTrustToken(),
    });

    const created = await sdk.agents.createAgent({ identifier: 'sdk-agent', name: 'SDK Agent' });
    expect(created).toMatchObject({ identifier: 'sdk-agent', name: 'SDK Agent' });

    const version = await sdk.agents.createAgentVersion({
      config: { systemRole: 'SDK prompt' },
      description: 'Created through SDK',
      identifier: 'sdk-agent',
      name: 'SDK Agent',
    });
    expect(version).toMatchObject({ description: 'Created through SDK', name: 'SDK Agent' });

    await expect(sdk.agents.publish('sdk-agent')).resolves.toMatchObject({
      identifier: 'sdk-agent',
      status: 'published',
      success: true,
    });

    const list = await sdk.agents.getAgentList({ page: 1, pageSize: 20 });
    expect(list.items).toEqual([
      expect.objectContaining({ identifier: 'sdk-agent', name: 'SDK Agent' }),
    ]);

    await expect(sdk.agents.getPublishedIdentifiers()).resolves.toContainEqual({
      id: 'sdk-agent',
      lastModified: expect.any(String),
    });
    await expect(sdk.agents.getCategories()).resolves.toEqual([]);

    const detail = await sdk.agents.getAgentDetail('sdk-agent');
    expect(detail.config).toEqual({ systemRole: 'SDK prompt' });

    await expect(sdk.agents.increaseInstallCount('sdk-agent')).resolves.toMatchObject({
      identifier: 'sdk-agent',
      installCount: 1,
      success: true,
    });

    const forkSdk = new MarketSDK({
      baseURL: 'http://market.test',
      trustedClientToken: createMarketTrustToken({
        email: 'market-sdk-forker@example.com',
        name: 'Market SDK Forker',
        userId: 'market-sdk-forker',
      }),
    });

    const fork = await forkSdk.agents.forkAgent('sdk-agent', {
      identifier: 'sdk-agent-fork',
      name: 'SDK Agent Fork',
      visibility: 'private',
    });
    expect(fork).toMatchObject({
      agent: {
        forkedFromAgentId: created.id,
        identifier: 'sdk-agent-fork',
        name: 'SDK Agent Fork',
      },
      source: { agentId: created.id, identifier: 'sdk-agent' },
    });

    await expect(forkSdk.agents.getAgentForks('sdk-agent')).resolves.toMatchObject({
      forks: [expect.objectContaining({ identifier: 'sdk-agent-fork', name: 'SDK Agent Fork' })],
      totalCount: 1,
    });
    await expect(forkSdk.agents.getAgentForkSource('sdk-agent-fork')).resolves.toMatchObject({
      source: expect.objectContaining({ identifier: 'sdk-agent', name: 'SDK Agent' }),
    });

    await expect(forkSdk.agents.getAgentDetail('sdk-agent-fork')).resolves.toMatchObject({
      config: { systemRole: 'SDK prompt' },
      identifier: 'sdk-agent-fork',
      visibility: 'private',
    });
  });

  it('preserves Request method, body, and headers in the Market test fetch adapter', async () => {
    const request = new Request('http://market.test/api/v1/agents/create', {
      body: JSON.stringify({ identifier: 'request-agent', name: 'Request Agent' }),
      headers: {
        'content-type': 'application/json',
        'x-lobe-trust-token': createMarketTrustToken(),
      },
      method: 'POST',
    });

    const response = await fetchFn(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      identifier: 'request-agent',
      name: 'Request Agent',
    });
  });

  it('lets explicit init override Request method, body, and headers in the Market test fetch adapter', async () => {
    const request = new Request('http://market.test/api/v1/agents/create', {
      headers: { 'content-type': 'text/plain' },
      method: 'GET',
    });

    const response = await fetchFn(request, {
      body: JSON.stringify({ identifier: 'init-agent', name: 'Init Agent' }),
      headers: {
        'content-type': 'application/json',
        'x-lobe-trust-token': createMarketTrustToken(),
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      identifier: 'init-agent',
      name: 'Init Agent',
    });
  });
});
