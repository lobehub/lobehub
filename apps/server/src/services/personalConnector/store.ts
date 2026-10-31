import { getDisabledPluginIds, upsertPluginMode } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel, type SyncToolInput } from '@/database/models/connectorTool';
import {
  agents,
  type ConnectorMetadata,
  type UserConnectorItem,
  userConnectors,
  userConnectorTools,
  userInstalledPlugins,
} from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { canUseNativeConnector } from '@/libs/mcp/connectorAccessPolicy';
import { nativeConnectorLockKey, withNativeConnectorLock } from '@/libs/mcp/nativeConnectorLock';

import type { PersonalConnection, PersonalConnectionStore, PersonalProvider } from './index';
import type { PersonalReadEvidence, PersonalReadHistory } from './readEvidence';

type StoredState = Omit<PersonalConnection, 'id' | 'userId'>;
type Database = LobeChatDatabase | Transaction;

export class DatabasePersonalConnectionStore implements PersonalConnectionStore {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private providers: (Pick<PersonalProvider, 'id' | 'name'> & {
      readToolNames?: string[];
      type?: 'composio' | 'lobehub';
    })[],
  ) {}

  private scope = () =>
    and(
      eq(userConnectors.userId, this.userId),
      isNull(userConnectors.workspaceId),
      inArray(
        userConnectors.identifier,
        this.providers.map((provider) => provider.id),
      ),
      ne(userConnectors.sourceType, 'custom'),
      isNull(userConnectors.mcpServerUrl),
    );

  private canonical(row: UserConnectorItem) {
    const provider = this.providers.find((item) => item.id === row.identifier);
    return (
      !provider?.type ||
      (provider.type === 'composio'
        ? !!row.metadata?.composio || !!row.metadata?.nativeAccess
        : !row.metadata?.composio)
    );
  }

  private version = (row: UserConnectorItem) => row.updatedAt.getTime();
  private versionIs = (version: number) =>
    sql`floor(extract(epoch from ${userConnectors.updatedAt}) * 1000) = ${version}`;

  private async project(
    row: UserConnectorItem,
    db: Database = this.db,
  ): Promise<PersonalConnection> {
    const cached = row.metadata?.personalConnection as StoredState | undefined;
    const authoritativeRemoteId = row.metadata?.composio?.connectedAccountId;
    const changedIdentity =
      !!authoritativeRemoteId && !!cached?.remoteId && cached.remoteId !== authoritativeRemoteId;
    const state = changedIdentity ? undefined : cached;
    const managed = !!row.metadata && Object.hasOwn(row.metadata, 'nativeAccess');
    const policy = row.metadata?.nativeAccess;
    const provider = this.providers.find((item) => item.id === row.identifier)!;
    let agentIds = policy?.agentIds ?? [];
    let readToolNames = policy?.readToolNames ?? [];
    if (!managed) {
      const ownedAgents = await db
        .select({ id: agents.id, plugins: agents.plugins })
        .from(agents)
        .where(and(eq(agents.userId, this.userId), isNull(agents.workspaceId)));
      agentIds = ownedAgents
        .filter(
          (agent) =>
            (!row.agentId || agent.id === row.agentId) &&
            !getDisabledPluginIds(agent.plugins ?? undefined).includes(row.identifier),
        )
        .map((agent) => agent.id);
      const resolved = await Promise.all(
        agentIds.map(async (agentId: string) => {
          const [selected] = await new ConnectorModel(
            db as LobeChatDatabase,
            this.userId,
          ).resolveByIdentifiers([row.identifier], agentId);
          return selected?.id === row.id ? agentId : null;
        }),
      );
      agentIds = resolved.filter((id): id is string => id !== null);
      const tools = await db
        .select({ name: userConnectorTools.toolName })
        .from(userConnectorTools)
        .where(eq(userConnectorTools.userConnectorId, row.id));
      readToolNames = tools
        .map((tool) => tool.name)
        .filter((name) => provider.readToolNames?.includes(name));
    }
    let status: PersonalConnection['status'] =
      state?.status ??
      (row.status === 'connected' ? 'ready' : row.status === 'error' ? 'expired' : 'disconnected');
    if (
      status === 'ready' &&
      (row.status !== 'connected' ||
        (row.metadata?.composio?.status && row.metadata.composio.status !== 'ACTIVE'))
    )
      status = 'expired';
    if (
      managed &&
      row.identifier === 'notion' &&
      !['disconnecting', 'disconnect_failed'].includes(status)
    )
      status = 'unavailable';
    if (managed && (changedIdentity || (status === 'ready' && readToolNames.length === 0)))
      status = 'sync_failed';
    const owned = await db
      .select({ id: agents.id, plugins: agents.plugins })
      .from(agents)
      .where(and(eq(agents.userId, this.userId), isNull(agents.workspaceId)));
    const activeAgentIds =
      row.isEnabled && status === 'ready'
        ? agentIds.filter((id: string) =>
            owned.some(
              (agent) =>
                canUseNativeConnector(row, id) &&
                agent.id === id &&
                !getDisabledPluginIds(agent.plugins ?? undefined).includes(row.identifier),
            ),
          )
        : [];
    const histories = (row.metadata?.nativeReadEvidence ?? {}) as Record<
      string,
      PersonalReadHistory
    >;
    const reads = Object.values(histories)
      .flatMap((history) => [history.lastAttempt, history.lastSuccess])
      .filter(
        (read): read is PersonalReadEvidence =>
          !!read && read.revision === policy?.revision && activeAgentIds.includes(read.agentId),
      )
      .filter(
        (read, index, all) =>
          all.findIndex(
            (other) => other.toolCallId === read.toolCallId && other.agentId === read.agentId,
          ) === index,
      )
      .sort((a, b) => b.at - a.at);
    return {
      ...state,
      id: row.id,
      userId: row.userId,
      providerId: row.identifier,
      name: provider.name,
      agentId:
        row.agentId ??
        (typeof row.metadata?.mountedByAgentId === 'string' ? row.metadata.mountedByAgentId : null),
      managed,
      grantedScopes: state?.grantedScopes ?? null,
      accountKey:
        state?.accountKey ??
        (row.metadata?.legacyAccount as { accountKey?: string } | undefined)?.accountKey,
      accountLabel:
        state?.accountLabel ??
        (row.metadata?.legacyAccount as { accountLabel?: string } | undefined)?.accountLabel,
      revision: this.version(row),
      status,
      isEnabled: row.isEnabled && !changedIdentity && status !== 'unavailable',
      agentIds: Array.isArray(agentIds) ? agentIds : [],
      activeAgentIds,
      reads,
      accessRevision: policy?.revision ?? this.version(row),
      readToolNames: Array.isArray(readToolNames) ? readToolNames : [],
      readToolVersions: policy?.readToolVersions ?? state?.readToolVersions,
      remoteId: authoritativeRemoteId ?? state?.remoteId,
      backendData: row.metadata?.composio
        ? {
            type: 'composio',
            appSlug: row.metadata.composio.appSlug,
            authConfigId: row.metadata.composio.authConfigId,
          }
        : state?.backendData,
    };
  }

  /** Materialize existing account projections without adopting or changing access. */
  async importExisting(
    entries: {
      providerId: string;
      name: string;
      metadata?: ConnectorMetadata;
      tools?: SyncToolInput[];
    }[],
  ) {
    for (const entry of entries) {
      if (!this.providers.some((provider) => provider.id === entry.providerId)) continue;
      await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${nativeConnectorLockKey(this.userId, entry.providerId)}))`,
        );
        const existing = await tx
          .select()
          .from(userConnectors)
          .where(
            and(
              this.scope(),
              eq(userConnectors.identifier, entry.providerId),
              isNull(userConnectors.agentId),
            ),
          );
        if (existing.some((row) => this.canonical(row))) return;
        const [row] = await tx
          .insert(userConnectors)
          .values({
            userId: this.userId,
            identifier: entry.providerId,
            name: entry.name,
            sourceType: 'marketplace',
            status: 'connected',
            isEnabled: true,
            metadata: entry.metadata ?? {},
          })
          .returning();
        if (entry.tools?.length)
          await new ConnectorToolModel(tx as LobeChatDatabase, this.userId).upsertMany(
            row.id,
            entry.tools,
          );
      });
    }
  }

  async list() {
    const rows = (await this.db.select().from(userConnectors).where(this.scope())).filter((row) =>
      this.canonical(row),
    );
    return Promise.all(rows.map((row) => this.project(row)));
  }

  private async raw(id: string, db: Database = this.db) {
    const [row] = await db
      .select()
      .from(userConnectors)
      .where(and(this.scope(), eq(userConnectors.id, id)))
      .limit(1);
    return row && this.canonical(row) ? row : null;
  }

  async get(id: string) {
    const row = await this.raw(id);
    return row ? this.project(row) : null;
  }

  async getBySession(id: string) {
    const [row] = await this.db
      .select()
      .from(userConnectors)
      .where(
        and(
          this.scope(),
          sql`${userConnectors.metadata} #>> '{personalConnection,authorization,id}' = ${id}`,
        ),
      )
      .limit(1);
    return row ? this.project(row) : null;
  }

  private values(connection: PersonalConnection, existing: UserConnectorItem, version: number) {
    const previousAuthorization = (existing.metadata?.personalConnection as StoredState | undefined)
      ?.authorization;
    const explicitAuthorization =
      connection.status === 'authorizing' &&
      connection.authorization?.id === previousAuthorization?.id &&
      previousAuthorization &&
      ['pending', 'unknown'].includes(previousAuthorization.status);
    if (
      existing.metadata?.composio?.connectedAccountId &&
      connection.remoteId &&
      existing.metadata.composio.connectedAccountId !== connection.remoteId &&
      !explicitAuthorization
    )
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The connected account identity changed; refresh before confirming access',
      });

    const {
      id: _id,
      userId: _userId,
      reads: _reads,
      activeAgentIds: _active,
      ...state
    } = connection;
    const prior = existing.metadata?.personalConnection as StoredState | undefined;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const policyUnchanged =
      prior &&
      ['accountKey', 'remoteId', 'isEnabled', 'status', 'grantedScopes'].every((key) =>
        same(prior[key as keyof StoredState], connection[key as keyof PersonalConnection]),
      ) &&
      same(prior.agentIds, connection.agentIds) &&
      same(prior.readToolNames, connection.readToolNames) &&
      same(prior.readToolVersions, connection.readToolVersions);
    const accessRevision = policyUnchanged
      ? (existing.metadata?.nativeAccess?.revision ?? version)
      : version;
    const metadata = {
      ...existing.metadata,
      personalConnection: { ...state, revision: version },
      ...(connection.managed
        ? {
            nativeAccess: {
              agentIds: connection.agentIds,
              readToolNames: connection.readToolNames,
              readToolVersions: connection.readToolVersions,
              revision: accessRevision,
            },
          }
        : {}),
    };
    if (connection.managed && connection.remoteId && connection.backendData?.type === 'composio') {
      metadata.composio = {
        appSlug: String(connection.backendData.appSlug),
        authConfigId: String(connection.backendData.authConfigId),
        connectedAccountId: connection.remoteId,
        linkedByUserId: this.userId,
        status:
          connection.status === 'ready'
            ? 'ACTIVE'
            : connection.status === 'authorizing'
              ? 'PENDING'
              : 'FAILED',
      };
    }
    return {
      metadata,
      isEnabled: connection.managed ? connection.isEnabled : existing.isEnabled,
      updatedAt: new Date(version),
      status: connection.managed
        ? connection.status === 'ready'
          ? 'connected'
          : 'disconnected'
        : existing.status,
    };
  }

  private async saveIn(db: Database, connection: PersonalConnection, expectedRevision: number) {
    const existing = await this.raw(connection.id, db);
    if (!existing || existing.userId !== connection.userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    }
    if (this.version(existing) !== expectedRevision) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Connection version conflict' });
    }
    const version = Math.max(Date.now(), expectedRevision + 1);
    const [saved] = await db
      .update(userConnectors)
      .set(this.values(connection, existing, version))
      .where(
        and(this.scope(), eq(userConnectors.id, connection.id), this.versionIs(expectedRevision)),
      )
      .returning();
    if (!saved) throw new TRPCError({ code: 'CONFLICT', message: 'Connection version conflict' });
    return this.project(saved, db);
  }

  private async saveConfirmed(
    tx: Transaction,
    connection: PersonalConnection,
    expectedRevision: number,
    replacements: { id: string; revision: number }[] = [],
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${nativeConnectorLockKey(this.userId, connection.providerId)}))`,
    );
    const existing = await this.raw(connection.id, tx);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    const previous = await this.project(existing, tx);
    const ownedAgents = await tx
      .select({ id: agents.id, plugins: agents.plugins })
      .from(agents)
      .where(and(eq(agents.userId, this.userId), isNull(agents.workspaceId)));
    if (connection.agentIds.some((id) => !ownedAgents.some((agent) => agent.id === id))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent access cannot be changed' });
    }
    const others = await tx
      .select()
      .from(userConnectors)
      .where(
        and(
          this.scope(),
          eq(userConnectors.identifier, connection.providerId),
          ne(userConnectors.id, connection.id),
        ),
      );
    for (const other of others) {
      const prior = await this.project(other, tx);
      if (!prior.agentIds.some((id) => connection.agentIds.includes(id))) continue;
      const acknowledgement = replacements.find((item) => item.id === other.id);
      if (acknowledgement?.revision !== this.version(other)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Refresh and confirm replacing the other selected account',
        });
      }
      if (!prior.managed) continue;
      const remaining = prior.agentIds.filter((id) => !connection.agentIds.includes(id));
      await this.saveIn(
        tx,
        {
          ...prior,
          agentIds: remaining,
          isEnabled: prior.isEnabled && remaining.length > 0,
          authorization: prior.authorization && {
            ...prior.authorization,
            previous: prior.authorization.previous && {
              ...prior.authorization.previous,
              agentIds: remaining,
            },
          },
        },
        prior.revision,
      );
    }
    const removed = previous.agentIds.filter((id) => !connection.agentIds.includes(id));
    for (const agent of ownedAgents) {
      if (!connection.agentIds.includes(agent.id) && !removed.includes(agent.id)) continue;
      const anotherGrant = others.some(
        (other) =>
          other.metadata?.nativeAccess?.agentIds.includes(agent.id) &&
          !connection.agentIds.includes(agent.id),
      );
      const mode = connection.agentIds.includes(agent.id) || anotherGrant ? 'auto' : 'disabled';
      const plugins = upsertPluginMode(agent.plugins ?? undefined, connection.providerId, mode);
      await tx
        .update(agents)
        .set({ plugins: plugins as unknown as string[] })
        .where(
          and(eq(agents.id, agent.id), eq(agents.userId, this.userId), isNull(agents.workspaceId)),
        );
    }
    if (!previous.managed && connection.managed && connection.readToolNames.length) {
      await tx
        .update(userConnectorTools)
        .set({ permission: 'auto' })
        .where(
          and(
            eq(userConnectorTools.userConnectorId, connection.id),
            inArray(userConnectorTools.toolName, connection.readToolNames),
          ),
        );
    }
    return this.saveIn(tx, connection, expectedRevision);
  }

  async save(
    connection: PersonalConnection,
    expectedRevision: number,
    options?: {
      confirmAgents?: boolean;
      replacements?: { id: string; revision: number }[];
    },
  ) {
    return withNativeConnectorLock(this.db, this.userId, connection.providerId, (tx) =>
      options?.confirmAgents
        ? this.saveConfirmed(tx, connection, expectedRevision, options.replacements)
        : this.saveIn(tx, connection, expectedRevision),
    );
  }

  async reserve(
    providerId: string,
    requestId: string,
    sessionId: string,
    expiresAt: number,
    options?: { connectionId?: string; adoptReadOnly?: boolean },
  ) {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Service not supported' });
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${nativeConnectorLockKey(this.userId, providerId)}))`,
      );
      const [existing] = await tx
        .select()
        .from(userConnectors)
        .where(
          and(
            this.scope(),
            eq(userConnectors.identifier, providerId),
            options?.connectionId
              ? eq(userConnectors.id, options.connectionId)
              : and(
                  isNull(userConnectors.agentId),
                  sql`coalesce(${userConnectors.metadata}->>'mountedByAgentId', '') = ''`,
                ),
          ),
        )
        .limit(1);
      if (existing && !this.canonical(existing))
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This connection uses a different service backend',
        });
      if (options?.connectionId && !existing)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
      const previous = existing ? await this.project(existing, tx) : undefined;
      const authorization = previous?.authorization;
      if (
        previous &&
        (authorization?.requestId === requestId ||
          (authorization &&
            ['pending', 'unknown'].includes(authorization.status) &&
            authorization.expiresAt > Date.now()))
      ) {
        return { connection: previous, created: false };
      }
      if (previous?.status === 'disconnecting') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Disconnect is still being processed' });
      }
      if (previous && !previous.managed && !options?.adoptReadOnly) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Confirm read-only management for this existing connection',
        });
      }
      const row =
        existing ??
        (
          await tx
            .insert(userConnectors)
            .values({
              userId: this.userId,
              identifier: providerId,
              name: provider.name,
              status: 'disconnected',
              sourceType: 'marketplace',
              isEnabled: false,
              metadata: { nativeAccess: { agentIds: [], readToolNames: [] } },
            })
            .returning()
        )[0];
      const connection = await this.saveIn(
        tx,
        {
          ...(previous ?? (await this.project(row, tx))),
          status: 'authorizing',
          accountKey: undefined,
          accountLabel: undefined,
          grantedScopes: null,
          managed: true,
          isEnabled: false,
          agentIds: previous?.agentIds ?? [],
          readToolNames: [],
          readToolVersions: {},
          lastError: undefined,
          authorization: {
            id: sessionId,
            requestId,
            expiresAt,
            status: 'pending',
            previous: previous && {
              accountKey: previous.accountKey,
              accountLabel: previous.accountLabel,
              agentIds: previous.agentIds,
              remoteId: previous.remoteId,
              backendData: previous.backendData,
              readToolNames: previous.readToolNames,
              status: previous.status,
            },
          },
        },
        this.version(row),
      );
      return { connection, created: true };
    });
  }

  async remove(id: string, expectedRevision: number) {
    await this.db.transaction(async (tx) => {
      const row = await this.raw(id, tx);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
      const [removed] = await tx
        .delete(userConnectors)
        .where(and(this.scope(), eq(userConnectors.id, id), this.versionIs(expectedRevision)))
        .returning({ id: userConnectors.id });
      if (!removed)
        throw new TRPCError({ code: 'CONFLICT', message: 'Connection version conflict' });
      if (!row.agentId && row.metadata?.composio) {
        await tx
          .delete(userInstalledPlugins)
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              isNull(userInstalledPlugins.workspaceId),
              eq(userInstalledPlugins.identifier, row.identifier),
              sql`${userInstalledPlugins.customParams} #>> '{composio,connectedAccountId}' = ${row.metadata.composio.connectedAccountId}`,
            ),
          );
      }
    });
  }
}
