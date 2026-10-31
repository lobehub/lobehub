import { readComposioToolVersion } from '@lobechat/connector-data';
import { hasGmailReadPermission } from '@lobechat/connector-data/gmail';
import { toRecord } from '@lobechat/utils/object';

import { isComposioConnectedAccountLookupNotFoundError } from '@/libs/composio';
import {
  type ComposioAuthorizationClient,
  createComposioAuthorization,
} from '@/server/services/composio/authorization';
import type { MarketService } from '@/server/services/market';

import { personalConnectorDefinitions } from './catalog';
import type { PersonalConnection, PersonalConnectorBackend } from './index';

interface SyncedTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
}
type SyncTools = (connectionId: string, tools: SyncedTool[]) => Promise<void>;
interface ComposioClient extends ComposioAuthorizationClient {
  connectedAccounts: ComposioAuthorizationClient['connectedAccounts'] & {
    get: (id: string) => Promise<unknown>;
    list: (input: {
      userIds: string[];
      toolkitSlugs: string[];
      limit: number;
      cursor?: string;
    }) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
  };
  tools: {
    getRawComposioTools: (input: { toolkits: string[] }) => Promise<unknown>;
    getRawComposioToolBySlug: (slug: string) => Promise<unknown>;
  };
}

const parseScopes = (value: unknown) =>
  (Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.slice(0, 8000).split(/[\s,]+/)
      : []
  )
    .filter((item): item is string => typeof item === 'string')
    .slice(0, 100)
    .map((scope) => scope.slice(0, 512))
    .sort();
const scopeAllowsRead = (provider: string, scopes: string[]) => {
  if (provider === 'gmail') return hasGmailReadPermission(scopes);
  const normalized = scopes.map((scope) => scope.replace('https://www.googleapis.com/auth/', ''));
  const known =
    provider === 'google-calendar'
      ? [
          'calendar',
          'calendar.readonly',
          'calendar.events',
          'calendar.events.readonly',
          'calendar.events.owned',
          'calendar.events.owned.readonly',
        ]
      : ['drive', 'drive.readonly', 'drive.file'];
  return normalized.some((scope) => known.includes(scope));
};

export class ComposioPersonalConnectorBackend implements PersonalConnectorBackend {
  readonly provider;
  private definition;

  constructor(
    private deps: {
      providerId: 'gmail' | 'google-calendar' | 'google-drive';
      userId: string;
      client: ComposioClient;
      available: boolean;
      syncTools: SyncTools;
      revokeAccount: (connection: PersonalConnection, remove: () => Promise<void>) => Promise<void>;
    },
  ) {
    this.definition = personalConnectorDefinitions.find(
      (provider) => provider.id === deps.providerId,
    )!;
    this.provider = {
      id: deps.providerId,
      name: this.definition.name,
      available: deps.available,
      ...(!deps.available ? { unavailableReason: 'service_unavailable' } : {}),
    };
  }

  async authorize(connection: PersonalConnection, callbackUrl: string) {
    const linked = await createComposioAuthorization(this.deps.client, {
      identifier: this.provider.id,
      appSlug: this.definition.appSlug,
      userId: this.deps.userId,
      callbackUrl,
      ...(connection.agentId ? { allowMultiple: true } : {}),
    });
    return {
      url: linked.redirectUrl,
      remoteId: linked.connectedAccountId,
      backendData: {
        type: 'composio',
        appSlug: this.definition.appSlug,
        authConfigId: linked.authConfigId,
      },
    };
  }

  private async ownedAccount(remoteId?: string) {
    if (!remoteId) return undefined;
    const client = this.deps.client;
    let owned: Record<PropertyKey, unknown> | undefined;
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const response = toRecord(
        await client.connectedAccounts.list({
          userIds: [this.deps.userId],
          toolkitSlugs: [this.definition.appSlug.toLowerCase()],
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const items = Array.isArray(response?.items) ? response.items.slice(0, 100) : [];
      owned = items.map(toRecord).find((item) => item?.id === remoteId);
      if (owned) break;
      cursor = typeof response?.nextCursor === 'string' ? response.nextCursor : undefined;
      if (!cursor) break;
    }
    return owned;
  }

  async inspect(connection: PersonalConnection): ReturnType<PersonalConnectorBackend['inspect']> {
    const pending = { status: 'pending' as const, readToolNames: [] };
    const client = this.deps.client;
    const remoteId = connection.remoteId;
    if (!remoteId) return pending;
    const owned = await this.ownedAccount(remoteId);
    if (!owned) return pending;
    const detail = toRecord(await client.connectedAccounts.get(remoteId));
    const toolkit = toRecord(detail?.toolkit);
    if (
      toolkit?.slug &&
      String(toolkit.slug).toLowerCase() !== this.definition.appSlug.toLowerCase()
    ) {
      return { status: 'expired', readToolNames: [] };
    }
    const status = String(detail?.status ?? owned.status).toUpperCase();
    if (
      ['EXPIRED', 'FAILED', 'INACTIVE', 'REVOKED', 'DELETED'].includes(status) ||
      detail?.isDisabled === true
    ) {
      return { status: 'expired', readToolNames: [] };
    }
    if (status !== 'ACTIVE') return pending;
    const data = toRecord(detail?.data);
    const listedData = toRecord(owned.data);
    const state = toRecord(toRecord(detail?.state)?.val);
    const listedState = toRecord(toRecord(owned.state)?.val);
    const scopesValue =
      detail?.scopes ??
      data?.scopes ??
      detail?.scope ??
      data?.scope ??
      state?.scope ??
      owned.scopes ??
      listedData?.scopes ??
      listedState?.scope;
    const scopes = parseScopes(scopesValue);
    const grantedScopes =
      Array.isArray(scopesValue) || typeof scopesValue === 'string' ? scopes : null;
    if (!scopeAllowsRead(this.provider.id, scopes))
      return { status: 'permission_required', readToolNames: [], grantedScopes };
    const email =
      detail?.email ?? data?.email ?? state?.email ?? listedData?.email ?? listedState?.email;
    const accountLabel = typeof email === 'string' ? email.slice(0, 320) : undefined;

    const raw = await client.tools.getRawComposioTools({ toolkits: [this.definition.appSlug] });
    const values = Array.isArray(raw) ? raw : toRecord(raw)?.items;
    if (!Array.isArray(values)) return { status: 'sync_failed', readToolNames: [], grantedScopes };
    const tools: SyncedTool[] = [];
    const readToolVersions: Record<string, string> = {};
    for (const value of values.slice(0, 1000)) {
      const tool = toRecord(value);
      const name = tool?.slug ?? tool?.name;
      if (typeof name !== 'string' || name.length > 255) continue;
      tools.push({
        name,
        description: typeof tool?.description === 'string' ? tool.description : undefined,
        inputSchema: toRecord(tool?.inputParameters ?? tool?.inputSchema) as
          Record<string, unknown> | undefined,
      });
      if (!(this.definition.readToolNames as readonly string[]).includes(name)) continue;
      let version = readComposioToolVersion(tool?.version);
      if (!version)
        version = readComposioToolVersion(
          toRecord(await client.tools.getRawComposioToolBySlug(name))?.version,
        );
      if (version) readToolVersions[name] = version;
    }
    const readToolNames = Object.keys(readToolVersions);
    if (readToolNames.length === 0)
      return { status: 'sync_failed', readToolNames: [], grantedScopes };
    await this.deps.syncTools(connection.id, tools);
    return {
      status: 'ready',
      grantedScopes,
      readToolNames,
      readToolVersions,
      accountLabel,
      accountKey: accountLabel
        ? `${this.provider.id}:${connection.remoteId}:${accountLabel}`
        : undefined,
    };
  }

  async revoke(connection: PersonalConnection) {
    const remoteId = connection.remoteId;
    if (!remoteId) throw new Error('Provider account could not be confirmed');
    let alreadyRemoved = false;
    if (!(await this.ownedAccount(remoteId))) {
      try {
        await this.deps.client.connectedAccounts.get(remoteId);
      } catch (error) {
        if (!isComposioConnectedAccountLookupNotFoundError(error)) throw error;
        alreadyRemoved = true;
      }
      if (!alreadyRemoved) throw new Error('Provider account ownership could not be confirmed');
    }
    await this.deps.revokeAccount(connection, async () => {
      if (alreadyRemoved) return;
      try {
        await this.deps.client.connectedAccounts.delete(remoteId);
      } catch (error) {
        if (!isComposioConnectedAccountLookupNotFoundError(error)) throw error;
      }
    });
  }
}

export class MarketPersonalConnectorBackend implements PersonalConnectorBackend {
  readonly provider;
  private definition = personalConnectorDefinitions.find((provider) => provider.id === 'notion')!;

  constructor(
    private deps: {
      userId: string;
      market: MarketService;
      available: boolean;
      syncTools: SyncTools;
    },
  ) {
    this.provider = {
      id: 'notion',
      name: 'Notion',
      available: false,
      unavailableReason: deps.available ? 'account_binding_required' : 'service_unavailable',
    };
  }

  async authorize(_connection: PersonalConnection, _callbackUrl: string): Promise<{ url: string }> {
    throw new Error('Account-bound Market authorization is unavailable');
  }

  async inspect(_connection: PersonalConnection): ReturnType<PersonalConnectorBackend['inspect']> {
    const connection = await this.deps.market.market.connect.getStatus('notion');
    if (!connection.success || !connection.connected || !connection.connection)
      return { status: 'pending', readToolNames: [] };
    const health = await this.deps.market.market.connect.getHealth('notion');
    if (!health.success || !health.healthy) return { status: 'expired', readToolNames: [] };
    const response = await this.deps.market.listSkillTools('notion', { timeoutMs: 10_000 });
    if (response.source !== 'live' || !Array.isArray(response.tools))
      return { status: 'sync_failed', readToolNames: [] };
    const tools = response.tools
      .map(toRecord)
      .filter((tool) => typeof tool?.name === 'string')
      .map((tool) => ({
        name: tool!.name as string,
        description: typeof tool!.description === 'string' ? tool!.description : undefined,
        inputSchema: toRecord(tool!.inputSchema) as Record<string, unknown>,
      }));
    const readToolNames = tools
      .map((tool) => tool.name)
      .filter((name) => (this.definition.readToolNames as readonly string[]).includes(name));
    if (readToolNames.length === 0) return { status: 'sync_failed', readToolNames: [] };
    await this.deps.syncTools(_connection.id, tools);
    const account = connection.connection;
    return {
      status: 'ready',
      readToolNames,
      grantedScopes: Array.isArray(account.scopes) ? parseScopes(account.scopes) : null,
      accountKey: `notion:${account.providerUserId ?? ''}:${account.createdAt}`,
      accountLabel: account.providerEmail ?? account.providerUsername ?? account.providerName,
    };
  }

  async revoke(connection: PersonalConnection) {
    const current = await this.deps.market.market.connect.getStatus('notion');
    if (!current.success) throw new Error('Provider status could not be confirmed');
    if (!current.connected) return;
    if (connection.managed) throw new Error('Account-bound Market revocation is unavailable');
    const account = current.connection;
    const identity = account && `notion:${account.providerUserId ?? ''}:${account.createdAt}`;
    if (connection.accountKey && identity !== connection.accountKey)
      throw new Error('The connected account changed');
    const revoked = await this.deps.market.market.connect.revoke('notion');
    if (!revoked.success) throw new Error('The provider could not be disconnected');
  }
}
