import { toRecord } from '@lobechat/utils/object';
import { and, eq, isNull } from 'drizzle-orm';

import { userInstalledPlugins } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { inferCrudType } from '@/libs/mcp/utils';
import type { MarketService } from '@/server/services/market';

import { personalConnectorDefinitions } from './catalog';
import type { DatabasePersonalConnectionStore } from './store';

/** Existing LobeHub accounts remain unmanaged until the user explicitly adopts them. */
export const importExistingPersonalConnections = async (
  deps: {
    db: LobeChatDatabase;
    userId: string;
    store: DatabasePersonalConnectionStore;
    market?: MarketService;
  },
  providerId?: string,
) => {
  const plugins = await deps.db
    .select()
    .from(userInstalledPlugins)
    .where(
      and(eq(userInstalledPlugins.userId, deps.userId), isNull(userInstalledPlugins.workspaceId)),
    );
  for (const plugin of plugins) {
    const definition = personalConnectorDefinitions.find(
      (provider) => provider.id === plugin.identifier && provider.type === 'composio',
    );
    const account = plugin.customParams?.composio;
    if (!definition || !account?.connectedAccountId || (providerId && providerId !== definition.id))
      continue;
    await deps.store.importExisting([
      {
        providerId: definition.id,
        name: definition.name,
        metadata: { composio: { ...account, linkedByUserId: deps.userId } },
        tools: (plugin.manifest?.api ?? []).map((tool) => ({
          toolName: tool.name,
          crudType: inferCrudType(tool.name),
          defaultPermission: ['required', 'always'].includes(String(tool.humanIntervention))
            ? 'needs_approval'
            : 'auto',
          description: tool.description,
          inputSchema: tool.parameters as Record<string, unknown>,
        })),
      },
    ]);
  }
  if (deps.market && (!providerId || providerId === 'notion')) {
    const response = await deps.market.market.connect.listConnections({
      signal: AbortSignal.timeout(5000),
    });
    for (const value of response.connections ?? []) {
      const account = toRecord(value);
      if (account?.providerId !== 'notion') continue;
      await deps.store.importExisting([
        {
          providerId: 'notion',
          name: 'Notion',
          metadata: {
            legacyAccount: {
              accountKey: `notion:${account.providerUserId ?? ''}:${account.createdAt}`,
              accountLabel:
                account.providerEmail ?? account.providerUsername ?? account.providerName,
            },
          },
        },
      ]);
    }
  }
};
