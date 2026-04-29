import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import type * as DrizzleMigrator from 'drizzle-orm/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  marketAccounts,
  marketAgentEvents,
  marketAgents,
  marketAgentVersions,
} from '../../../../../packages/database/src/schemas/market';
import { createMarketApp } from '../../app';
import type { MarketDatabase } from '../../types';

interface DatabaseTestUtils {
  getTestDB: () => Promise<MarketDatabase>;
}

interface AgentCreateJson {
  ownerId: number;
}

interface ErrorJson {
  error: {
    code: string;
  };
}

const trustedClientEnv = {
  MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub',
  MARKET_TRUSTED_CLIENT_SECRET: 'lobehub-market_tcs_test-secret-for-market-service',
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadDatabaseTestUtils = async (): Promise<DatabaseTestUtils> => {
  const moduleName = ['@lobechat/database', 'test-utils'].join('/');

  return await import(moduleName);
};

const { getTestDB } = await loadDatabaseTestUtils();

const readCreateJson = async (response: Response): Promise<AgentCreateJson> => {
  const json: unknown = await response.json();
  if (!isRecord(json) || typeof json.ownerId !== 'number') {
    throw new TypeError('Expected agent create response with ownerId.');
  }

  return { ownerId: json.ownerId };
};

const readErrorJson = async (response: Response): Promise<ErrorJson> => {
  const json: unknown = await response.json();
  if (!isRecord(json) || !isRecord(json.error) || typeof json.error.code !== 'string') {
    throw new TypeError('Expected error response with code.');
  }

  return { error: { code: json.error.code } };
};

const createToken = (userId: string, email: string, name: string) =>
  createTrustedClientToken(
    buildTrustedClientPayload({
      clientId: trustedClientEnv.MARKET_TRUSTED_CLIENT_ID,
      email,
      name,
      userId,
    }),
    trustedClientEnv.MARKET_TRUSTED_CLIENT_SECRET,
  );

const requestJson = (body: Record<string, unknown>, token?: string) => ({
  body: JSON.stringify(body),
  headers: {
    'content-type': 'application/json',
    ...(token ? { 'x-lobe-trust-token': token } : {}),
  },
  method: 'POST',
});

const createPublishedAgent = async (app: ReturnType<typeof createMarketApp>, token: string) => {
  await app.request(
    '/api/v1/agents/create',
    requestJson({ identifier: 'agent-one', name: 'Agent One' }, token),
  );
  await app.request(
    '/api/v1/agents/version/create',
    requestJson({ description: 'Initial description', identifier: 'agent-one' }, token),
  );
  await app.request(
    '/api/v1/agents/modify',
    requestJson({ identifier: 'agent-one', status: 'published' }, token),
  );
};

describe('Market HTTP agent routes', async () => {
  const db: MarketDatabase = await getTestDB();
  const ownerToken = createToken('owner-one', 'owner@example.com', 'Owner One');
  const otherToken = createToken('other-user', 'other@example.com', 'Other User');

  beforeEach(async () => {
    await db.delete(marketAgentEvents);
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);
  });

  it('returns OIDC userinfo for a trusted Market account', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request('/lobehub-oidc/userinfo', {
      headers: { 'x-lobe-trust-token': ownerToken },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accountId: expect.any(Number),
      email: 'owner@example.com',
      name: 'Owner One',
      sub: 'owner-one',
      userName: 'owner',
    });
  });

  it('creates, versions, publishes, lists, and counts an agent through HTTP', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const createResponse = await app.request(
      '/api/v1/agents/create',
      requestJson(
        {
          identifier: 'agent-one',
          name: 'Agent One',
        },
        ownerToken,
      ),
    );
    expect(createResponse.status).toBe(200);

    const versionResponse = await app.request(
      '/api/v1/agents/version/create',
      requestJson(
        {
          category: 'productivity',
          description: 'Agent One description',
          identifier: 'agent-one',
          summary: 'Agent One summary',
        },
        ownerToken,
      ),
    );
    expect(versionResponse.status).toBe(200);

    const publishResponse = await app.request(
      '/api/v1/agents/modify',
      requestJson(
        {
          identifier: 'agent-one',
          status: 'published',
        },
        ownerToken,
      ),
    );
    expect(publishResponse.status).toBe(200);

    const listResponse = await app.request('/api/v1/agents?status=published&visibility=public');
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      currentPage: 1,
      items: [
        expect.objectContaining({
          identifier: 'agent-one',
          name: 'Agent One',
        }),
      ],
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });

    const identifiersResponse = await app.request('/api/v1/agents/identifiers');
    expect(identifiersResponse.status).toBe(200);
    expect(await identifiersResponse.json()).toEqual([
      { id: 'agent-one', lastModified: expect.any(String) },
    ]);

    const categoriesResponse = await app.request('/api/v1/agents/categories');
    expect(categoriesResponse.status).toBe(200);
    expect(await categoriesResponse.json()).toEqual([{ category: 'productivity', count: 1 }]);

    const installCountResponse = await app.request(
      '/api/v1/agents/install-count',
      requestJson({ identifier: 'agent-one' }),
    );
    expect(installCountResponse.status).toBe(200);
    expect(await installCountResponse.json()).toMatchObject({
      identifier: 'agent-one',
      installCount: 1,
      success: true,
    });
  });

  it('rejects agent creation without a trusted token', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'agent-one', name: 'Agent One' }),
    );

    expect(response.status).toBe(401);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'missing_trusted_token' } });
  });

  it('returns an empty list for plugin lookups while plugin-agent links are unsupported', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'agent-one', name: 'Agent One' }, ownerToken),
    );
    await app.request(
      '/api/v1/agents/version/create',
      requestJson({ identifier: 'agent-one' }, ownerToken),
    );
    await app.request(
      '/api/v1/agents/modify',
      requestJson({ identifier: 'agent-one', status: 'published' }, ownerToken),
    );

    const response = await app.request('/api/v1/agents/by-plugin?pluginId=missing-plugin');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      currentPage: 1,
      items: [],
      pageSize: 20,
      totalCount: 0,
      totalPages: 0,
    });
  });

  it('rejects plugin lookups without a plugin id', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);

    const response = await app.request('/api/v1/agents/by-plugin');

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_plugin_id' } });
  });

  it('rejects POST bodies that are missing a required identifier with a 400 error', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request(
      '/api/v1/agents/create',
      requestJson({ name: 'No Identifier' }, ownerToken),
    );

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_agent_identifier' } });
  });

  it('rejects agent creation without a name with a 400 error', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'missing-name' }, ownerToken),
    );

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_agent_name' } });
  });

  it('rejects malformed JSON POST bodies with a 400 error', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request('/api/v1/agents/create', {
      body: '{',
      headers: {
        'content-type': 'application/json',
        'x-lobe-trust-token': ownerToken,
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_json' } });
  });

  it('rejects version modification without a version with a 400 error', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const response = await app.request(
      '/api/v1/agents/version/modify',
      requestJson({ identifier: 'agent-one' }, ownerToken),
    );

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_agent_version' } });
  });

  it('rejects agent events without an allowed event with a 400 error', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);

    const response = await app.request(
      '/api/v1/agents/events',
      requestJson({ identifier: 'agent-one' }, ownerToken),
    );

    expect(response.status).toBe(400);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'invalid_agent_event' } });
  });

  it('modifies an agent version through HTTP', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);

    const response = await app.request(
      '/api/v1/agents/version/modify',
      requestJson(
        {
          description: 'Updated description',
          identifier: 'agent-one',
          name: 'Updated Agent One',
          version: '1.0.0',
        },
        ownerToken,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      description: 'Updated description',
      name: 'Updated Agent One',
      version: '1.0.0',
    });
  });

  it('records an agent event through HTTP', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);
    const response = await app.request(
      '/api/v1/agents/events',
      requestJson({ event: 'click', identifier: 'agent-one' }, ownerToken),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      event: 'click',
      source: null,
    });
  });

  it('forks an agent through HTTP', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);
    const response = await app.request(
      '/api/v1/agents/agent-one/fork',
      requestJson({ identifier: 'forked-agent' }, otherToken),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agent: {
        identifier: 'forked-agent',
      },
      source: {
        identifier: 'agent-one',
      },
    });
  });

  it('does not expose unpublished public forks through public fork routes', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await createPublishedAgent(app, ownerToken);
    await app.request(
      '/api/v1/agents/agent-one/fork',
      requestJson({ identifier: 'draft-public-fork', visibility: 'public' }, otherToken),
    );
    await app.request(
      '/api/v1/agents/agent-one/fork',
      requestJson(
        { identifier: 'published-public-fork', status: 'published', visibility: 'public' },
        otherToken,
      ),
    );

    const response = await app.request('/api/v1/agents/agent-one/forks');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      forks: [expect.objectContaining({ identifier: 'published-public-fork' })],
      totalCount: 1,
    });
  });

  it('does not expose private agents through public ownerId query parameters', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    const createResponse = await app.request(
      '/api/v1/agents/create',
      requestJson(
        {
          identifier: 'private-agent',
          name: 'Private Agent',
          status: 'published',
          visibility: 'private',
        },
        ownerToken,
      ),
    );
    const { ownerId } = await readCreateJson(createResponse);

    await app.request(
      '/api/v1/agents/version/create',
      requestJson({ identifier: 'private-agent' }, ownerToken),
    );

    const response = await app.request(
      `/api/v1/agents?ownerId=${ownerId}&visibility=private&status=published`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [],
      totalCount: 0,
      totalPages: 0,
    });
  });

  it('does not expose unpublished public agents through public catalog routes', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'draft-agent', name: 'Draft Agent' }, ownerToken),
    );
    await app.request(
      '/api/v1/agents/version/create',
      requestJson({ identifier: 'draft-agent' }, ownerToken),
    );

    const listResponse = await app.request('/api/v1/agents');
    const unpublishedListResponse = await app.request('/api/v1/agents?status=unpublished');
    const detailResponse = await app.request('/api/v1/agents/detail/draft-agent');

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      items: [],
      totalCount: 0,
      totalPages: 0,
    });
    expect(unpublishedListResponse.status).toBe(200);
    expect(await unpublishedListResponse.json()).toMatchObject({
      items: [],
      totalCount: 0,
      totalPages: 0,
    });
    expect(detailResponse.status).toBe(404);
    expect(await readErrorJson(detailResponse)).toEqual({ error: { code: 'agent_not_found' } });
  });

  it('does not record public counters or events for unpublished agents', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'draft-agent', name: 'Draft Agent' }, ownerToken),
    );
    await app.request(
      '/api/v1/agents/version/create',
      requestJson({ identifier: 'draft-agent' }, ownerToken),
    );

    const installResponse = await app.request(
      '/api/v1/agents/install-count',
      requestJson({ identifier: 'draft-agent' }),
    );
    const eventResponse = await app.request(
      '/api/v1/agents/events',
      requestJson({ event: 'click', identifier: 'draft-agent' }),
    );

    expect(installResponse.status).toBe(404);
    expect(await readErrorJson(installResponse)).toEqual({ error: { code: 'agent_not_found' } });
    expect(eventResponse.status).toBe(404);
    expect(await readErrorJson(eventResponse)).toEqual({ error: { code: 'agent_not_found' } });
  });

  it('rejects agent modification by a different trusted account', async () => {
    const app = createMarketApp({ db, env: trustedClientEnv });

    await app.request(
      '/api/v1/agents/create',
      requestJson({ identifier: 'agent-one', name: 'Agent One' }, ownerToken),
    );

    const response = await app.request(
      '/api/v1/agents/modify',
      requestJson({ identifier: 'agent-one', name: 'Intruder Rename' }, otherToken),
    );

    expect(response.status).toBe(403);
    expect(await readErrorJson(response)).toEqual({ error: { code: 'agent_forbidden' } });
  });
});
