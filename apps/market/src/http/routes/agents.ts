import type {
  AgentCreateRequest,
  AgentEventRequest,
  AgentForkRequest,
  AgentListQuery,
  AgentModifyRequest,
  AgentVersionCreateRequest,
  AgentVersionModifyRequest,
} from '@lobehub/market-sdk';
import type { Context } from 'hono';
import { Hono } from 'hono';

import { MarketAccountModel } from '../../models/account';
import { AgentService } from '../../services/agents';
import type { MarketHonoEnv } from '../../types';
import { optionalTrustedAuth, trustedAuth } from '../auth';
import { getMarketDb } from '../context';
import { MarketHttpError } from '../errors';

export const toPositiveInteger = (value: string | null | undefined, fallback: number) => {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toStringQuery = (value: string | null) => value || undefined;

const toOrder = (value: string | null): AgentListQuery['order'] => {
  if (value === 'asc' || value === 'desc') return value;
};

const toIsOfficial = (value: string | null): AgentListQuery['isOfficial'] => {
  if (value === 'true' || value === 'false') return value;
};

const toSort = (value: string | null): AgentListQuery['sort'] => {
  if (
    value === 'createdAt' ||
    value === 'knowledgeCount' ||
    value === 'mostUsage' ||
    value === 'name' ||
    value === 'pluginCount' ||
    value === 'recommended' ||
    value === 'relevance' ||
    value === 'tokenUsage' ||
    value === 'updatedAt'
  ) {
    return value;
  }
};

const toStatus = (value: string | null): AgentListQuery['status'] => {
  if (
    value === 'published' ||
    value === 'unpublished' ||
    value === 'archived' ||
    value === 'deprecated' ||
    value === 'all'
  ) {
    return value;
  }
};

const toVisibility = (value: string | null): AgentListQuery['visibility'] => {
  if (value === 'public' || value === 'private' || value === 'internal' || value === 'all') {
    return value;
  }
};

const createListQuery = (
  searchParams: URLSearchParams,
  options: { includeOwnerId?: boolean } = {},
): AgentListQuery => ({
  category: toStringQuery(searchParams.get('category')),
  isOfficial: toIsOfficial(searchParams.get('isOfficial')),
  locale: toStringQuery(searchParams.get('locale')),
  order: toOrder(searchParams.get('order')),
  ownerId: options.includeOwnerId ? toStringQuery(searchParams.get('ownerId')) : undefined,
  page: toPositiveInteger(searchParams.get('page'), 1),
  pageSize: toPositiveInteger(searchParams.get('pageSize'), 20),
  q: toStringQuery(searchParams.get('q')),
  sort: toSort(searchParams.get('sort')),
  status: toStatus(searchParams.get('status')),
  visibility: toVisibility(searchParams.get('visibility')),
});

const createEmptyList = (query: AgentListQuery) => ({
  currentPage: query.page ?? 1,
  items: [],
  pageSize: query.pageSize ?? 20,
  totalCount: 0,
  totalPages: 0,
});

const readJsonObject = async (c: Context<MarketHonoEnv>) => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    throw new MarketHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MarketHttpError(400, 'invalid_json', 'Request body must be a JSON object.');
  }

  return body as Record<string, unknown>;
};

const getIdentifier = (body: Record<string, unknown>) => {
  if (typeof body.identifier !== 'string' || !body.identifier) {
    throw new MarketHttpError(400, 'invalid_agent_identifier', 'Agent identifier is required.');
  }

  return body.identifier;
};

const getName = (body: { name?: unknown }) => {
  if (typeof body.name !== 'string' || !body.name) {
    throw new MarketHttpError(400, 'invalid_agent_name', 'Agent name is required.');
  }

  return body.name;
};

const getVersion = (body: { version?: unknown }) => {
  if (typeof body.version !== 'string' || !body.version) {
    throw new MarketHttpError(400, 'invalid_agent_version', 'Agent version is required.');
  }

  return body.version;
};

const getEvent = (body: { event?: unknown }) => {
  if (body.event === 'add' || body.event === 'chat' || body.event === 'click') return body.event;

  throw new MarketHttpError(400, 'invalid_agent_event', 'Agent event is required.');
};

const readIdentifierBody = async <T extends { identifier: string }>(c: Context<MarketHonoEnv>) => {
  const body = await readJsonObject(c);
  getIdentifier(body);

  return body as T;
};

const getAccountId = async (c: Context<MarketHonoEnv>) => {
  const trustedPayload = c.get('trustedPayload');
  if (!trustedPayload) {
    throw new MarketHttpError(401, 'missing_trusted_token', 'A trusted client token is required.');
  }

  const account = await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(
    trustedPayload,
  );

  return account.id;
};

const getOptionalAccountId = async (c: Context<MarketHonoEnv>) => {
  const trustedPayload = c.get('trustedPayload');
  if (!trustedPayload) return undefined;

  const account = await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(
    trustedPayload,
  );

  return account.id;
};

export const createAgentRoutes = (): Hono<MarketHonoEnv> => {
  const app = new Hono<MarketHonoEnv>();

  app.get('/', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));

    return c.json(await service.listAgents(createListQuery(new URL(c.req.url).searchParams)));
  });

  app.get('/identifiers', async (c) =>
    c.json(await new AgentService(getMarketDb(c)).listIdentifiers()),
  );

  app.get('/categories', async (c) =>
    c.json(await new AgentService(getMarketDb(c)).listCategories()),
  );

  app.get('/by-plugin', optionalTrustedAuth(), async (c) => {
    const searchParams = new URL(c.req.url).searchParams;
    const query = createListQuery(searchParams);
    if (searchParams.has('pluginId')) return c.json(createEmptyList(query));

    const service = new AgentService(getMarketDb(c));

    return c.json(await service.listAgentsByPlugin(query));
  });

  app.get('/own', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const accountId = await getAccountId(c);

    return c.json(
      await service.listAgents({
        ...createListQuery(new URL(c.req.url).searchParams, { includeOwnerId: true }),
        ownerId: accountId,
      }),
    );
  });

  app.get('/detail/:identifier', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const accountId = await getOptionalAccountId(c);

    return c.json(
      await service.getAgentDetail(c.req.param('identifier'), {
        includePrivateForAccountId: accountId,
      }),
    );
  });

  app.post('/create', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readIdentifierBody<AgentCreateRequest>(c);
    getName(body);

    return c.json(await service.createAgent(await getAccountId(c), body));
  });

  app.post('/modify', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readIdentifierBody<AgentModifyRequest>(c);

    return c.json(await service.modifyAgent(await getAccountId(c), body));
  });

  app.post('/version/create', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readIdentifierBody<AgentVersionCreateRequest>(c);

    return c.json(await service.createAgentVersion(await getAccountId(c), body));
  });

  app.post('/version/modify', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readIdentifierBody<AgentVersionModifyRequest>(c);
    getVersion(body);

    return c.json(await service.modifyAgentVersion(await getAccountId(c), body));
  });

  app.post('/events', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const accountId = await getOptionalAccountId(c);
    const body = await readIdentifierBody<AgentEventRequest>(c);
    getEvent(body);

    return c.json(await service.createEvent(accountId ?? null, body));
  });

  app.post('/install-count', async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readJsonObject(c);
    const identifier = getIdentifier(body);

    return c.json(await service.increaseInstallCount(identifier));
  });

  app.get('/:identifier/forks', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const accountId = await getOptionalAccountId(c);

    return c.json(
      await service.listForks(c.req.param('identifier'), {
        includePrivateForAccountId: accountId,
      }),
    );
  });

  app.get('/:identifier/fork-source', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const accountId = await getOptionalAccountId(c);

    return c.json(
      await service.getForkSource(c.req.param('identifier'), {
        includePrivateForAccountId: accountId,
      }),
    );
  });

  app.post('/:sourceIdentifier/fork', trustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const body = await readIdentifierBody<AgentForkRequest>(c);

    return c.json(
      await service.forkAgent(await getAccountId(c), c.req.param('sourceIdentifier'), body),
    );
  });

  return app;
};
