import { getConnectorCatalog } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { ConnectorToolModel } from '@/database/models/connectorTool';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getComposioClient, isComposioClientAvailable } from '@/libs/composio';
import { inferCrudType } from '@/libs/mcp/utils';
import { resolveMarketUserContext } from '@/libs/trpc/lambda/middleware/marketUserInfo';
import { MarketService } from '@/server/services/market';

import { ComposioPersonalConnectorBackend, MarketPersonalConnectorBackend } from './backends';
import { personalConnectorDefinitions } from './catalog';
import { type PersonalConnectorBackend, PersonalConnectorService } from './index';
import { importExistingPersonalConnections } from './inventory';
import { guardComposioRevocation } from './revokeGuard';
import { DatabasePersonalConnectionStore } from './store';

/** Creates the real DB/provider adapters; no browser client reaches a private API. */
export const createPersonalConnectorService = async (
  db: LobeChatDatabase,
  userId: string,
  options: { workspaceId?: string; callbackOrigin?: string } = {},
) => {
  if (options.workspaceId)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Personal connections require personal scope',
    });
  const origin = options.callbackOrigin ?? process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (!origin)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Native service authorization is not available on this server',
    });
  const callbackUrl = new URL('/api/connectors/oauth/callback', origin).toString();
  const marketContext = await resolveMarketUserContext({ serverDB: db, userId });
  const marketAvailable = !!(marketContext.marketUserInfo || marketContext.marketAccessToken);
  const composioAvailable = isComposioClientAvailable();
  const catalog = getConnectorCatalog({ composio: composioAvailable, lobehub: marketAvailable });
  const available = new Map(
    catalog.map((item) => [
      item.type === 'composio' ? item.serverType.identifier : item.provider.id,
      item.type,
    ]),
  );
  const definitions = personalConnectorDefinitions.map((item) => ({
    ...item,
    readToolNames: [...item.readToolNames],
  }));
  const store = new DatabasePersonalConnectionStore(db, userId, definitions);
  const toolModel = new ConnectorToolModel(db, userId);
  const syncTools = async (
    id: string,
    tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[],
  ) => {
    const connection = await store.get(id);
    if (!connection) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    const definition = definitions.find((item) => item.id === connection.providerId)!;
    await toolModel.upsertMany(
      id,
      tools.map((tool) => {
        const read = new Set<string>(definition.readToolNames).has(tool.name);
        return {
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          crudType: read ? 'read' : inferCrudType(tool.name),
          defaultPermission: read && connection.managed ? 'auto' : 'disabled',
        };
      }),
    );
    await toolModel.deleteToolsNotIn(
      id,
      tools.map((tool) => tool.name),
    );
  };
  const unavailable = (id: string, name: string): PersonalConnectorBackend => ({
    provider: { id, name, available: false, unavailableReason: 'service_unavailable' },
    authorize: async () => {
      throw new Error('Service unavailable');
    },
    inspect: async () => {
      throw new Error('Service unavailable');
    },
    revoke: async () => {
      throw new Error('Service unavailable');
    },
  });
  const market = marketAvailable
    ? new MarketService({
        accessToken: marketContext.marketAccessToken,
        userInfo: marketContext.marketUserInfo,
      })
    : undefined;
  const backends = definitions.map((definition): PersonalConnectorBackend => {
    if (available.get(definition.id) !== definition.type)
      return unavailable(definition.id, definition.name);
    if (definition.type === 'composio')
      return new ComposioPersonalConnectorBackend({
        providerId: definition.id as 'gmail' | 'google-calendar' | 'google-drive',
        userId,
        client: getComposioClient() as any,
        available: true,
        syncTools,
        revokeAccount: (connection, remove) =>
          guardComposioRevocation(db, userId, connection, remove),
      });
    return new MarketPersonalConnectorBackend({
      userId,
      available: true,
      syncTools,
      market: market!,
    });
  });
  return new PersonalConnectorService({
    userId,
    store,
    backends,
    callbackUrl,
    bootstrap: (providerId) =>
      importExistingPersonalConnections({ db, userId, store, market }, providerId),
    canEditAgents: async (ids) => {
      if (ids.length === 0) return true;
      const owned = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.userId, userId), isNull(agents.workspaceId), inArray(agents.id, ids)));
      return new Set(owned.map((agent) => agent.id)).size === new Set(ids).size;
    },
  });
};
