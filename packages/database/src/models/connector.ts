import { upsertPluginMode } from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { ConnectorCredentials, NewUserConnector, UserConnectorItem } from '../schemas';
import { agents, ConnectorStatus, userConnectors, userConnectorTools } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { withNativeConnectorLock } from '../utils/nativeConnectorLock';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedConnector extends Omit<UserConnectorItem, 'credentials'> {
  credentials: ConnectorCredentials | null;
}

export interface ConnectorReference {
  id: string;
  isEnabled: boolean;
  status: string;
}

export interface PublicConnectorRecord {
  agentId: string | null;
  avatar: string | null;
  createdAt: Date;
  description: string | null;
  hasCredentials: boolean;
  id: string;
  identifier: string;
  isEnabled: boolean;
  mcpConnectionType: string | null;
  mcpServerUrl: string | null;
  name: string;
  sourceType: string;
  status: string;
  updatedAt: Date;
  /** Row creator. Needed for row-level manage checks; never surfaced to API responses. */
  userId: string;
}

export interface ComposioConnectorReference extends ConnectorReference {
  composio?: {
    appSlug: string;
    connectedAccountId: string;
    ownerUserId: string;
    status: string;
  };
}

const nativeRuntimeKeys = ['nativeAccess', 'personalConnection', 'nativeReadEvidence'] as const;

type CreateConnectorParams = Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>;

type UpdateConnectorParams = Partial<
  Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>
>;

export class ConnectorModel {
  private userId: string;
  private db: LobeChatDatabase;
  private gateKeeper?: GateKeeper;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string, gateKeeper?: GateKeeper) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.gateKeeper = gateKeeper;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, userConnectors);

  /**
   * Base (non-agent) scope: the current user/workspace scope restricted to rows
   * that are NOT bound to a specific agent (`agent_id IS NULL`). Agent-scoped
   * rows are a refinement resolved separately via {@link resolveByIdentifiers} /
   * {@link resolveAll}; base list/lookup methods must not surface them, otherwise
   * an agent connector would leak into personal/workspace management + resolution
   * and collide on identifier.
   */
  private baseScope = () => and(this.ownership(), isNull(userConnectors.agentId));

  private publicSelection = {
    agentId: userConnectors.agentId,
    avatar: sql<string | null>`${userConnectors.metadata} ->> 'avatar'`,
    createdAt: userConnectors.createdAt,
    description: sql<string | null>`${userConnectors.metadata} ->> 'description'`,
    hasCredentials: sql<boolean>`${userConnectors.credentials} IS NOT NULL`,
    id: userConnectors.id,
    identifier: userConnectors.identifier,
    isEnabled: userConnectors.isEnabled,
    mcpConnectionType: userConnectors.mcpConnectionType,
    mcpServerUrl: userConnectors.mcpServerUrl,
    name: userConnectors.name,
    sourceType: userConnectors.sourceType,
    status: userConnectors.status,
    updatedAt: userConnectors.updatedAt,
    userId: userConnectors.userId,
  };

  /**
   * Candidate rows for agent-aware resolution within the current scope. For an
   * agent this is:
   * - agent-OWNED rows (`agent_id = agentId`) — the Copy / Connect-new flows;
   * - base rows (`agent_id IS NULL`) that are either MOUNTED by this agent
   *   (`metadata.mountedByAgentId = agentId`, the Linked flow) or free (not
   *   mounted by anyone).
   * A base row mounted (locked) by *another* agent is excluded, so a mounted
   * connector can serve only its one agent. Without an agent, only free base
   * rows are candidates.
   */
  private scopePredicate = (agentId?: string) => {
    // COALESCE'd to a sentinel rather than null-tested: `->> … IS NULL` in a
    // WHERE clause is one bm25 index on `user_connectors` away from taking every
    // caller down at plan time. See the note on `TopicModel`. `''` is a safe
    // sentinel — a mount reference is always a real agent id, never empty.
    const mountedBy = sql`COALESCE(${userConnectors.metadata} ->> 'mountedByAgentId', '')`;
    if (!agentId) {
      return and(this.ownership(), isNull(userConnectors.agentId), sql`${mountedBy} = ''`);
    }
    return and(
      this.ownership(),
      or(
        eq(userConnectors.agentId, agentId),
        and(
          isNull(userConnectors.agentId),
          or(sql`${mountedBy} = ${agentId}`, sql`${mountedBy} = ''`),
        ),
      ),
    );
  };

  /**
   * Reduce candidate rows to at most one per identifier by priority within the
   * current scope: agent-OWNED (2) > MOUNTED by this agent (1) > free base (0).
   * Resolution never crosses the base scope: a workspace run resolves within the
   * workspace, a personal run within personal — no cross-scope personal fallback.
   */
  private pickByPriority = (rows: UserConnectorItem[], agentId?: string): UserConnectorItem[] => {
    const rank = (row: UserConnectorItem): number => {
      // An explicit native account choice wins over implicit agent/base scope.
      // Keep an expired selection authoritative as well: never silently fall
      // back to a different account while it is being reauthorized.
      if (agentId && row.metadata?.nativeAccess?.agentIds?.includes(agentId)) return 3;
      if (agentId && row.agentId === agentId) return 2;
      if (agentId && row.metadata?.mountedByAgentId === agentId) return 1;
      return 0;
    };
    const byIdentifier = new Map<string, UserConnectorItem>();
    for (const row of rows) {
      const current = byIdentifier.get(row.identifier);
      if (!current || rank(row) > rank(current)) byIdentifier.set(row.identifier, row);
    }
    return [...byIdentifier.values()];
  };

  create = async (
    params: CreateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<UserConnectorItem> => {
    if (params.metadata && nativeRuntimeKeys.some((key) => Object.hasOwn(params.metadata!, key)))
      throw new Error('Managed connection metadata is reserved for server authorization');
    const credentials = params.credentials
      ? await encryptCredentials(params.credentials, gateKeeper)
      : null;

    const [result] = await this.db
      .insert(userConnectors)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params, credentials },
        ),
      )
      .returning();

    return result;
  };

  /**
   * Clone an existing connector into an agent scope ("Copy user tool"): a new
   * independent row with the same config, bound to `agentId`. The encrypted
   * `credentials` ciphertext is copied verbatim (same vault key, so no
   * decrypt/re-encrypt needed) — which is why copying must happen server-side:
   * the client never receives the ciphertext. Any mount reference on the source
   * is dropped so the copy is a standalone agent-owned connector.
   */
  copyToAgent = async (sourceId: string, agentId: string): Promise<UserConnectorItem | null> => {
    const [source] = await this.db
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, sourceId), this.ownership()))
      .limit(1);
    if (!source) return null;

    if (source.metadata && Object.hasOwn(source.metadata, 'nativeAccess'))
      throw new Error('Managed connections require confirmed agent scope assignment');

    const copy = async (db: LobeChatDatabase, original: UserConnectorItem) => {
      const [source] = await db
        .select()
        .from(userConnectors)
        .where(and(eq(userConnectors.id, sourceId), this.ownership()))
        .limit(1);
      if (!source) return null;
      if (source.metadata && Object.hasOwn(source.metadata, 'nativeAccess'))
        throw new Error('Managed connections require confirmed agent scope assignment');
      if (
        source.metadata?.composio?.connectedAccountId !==
        original.metadata?.composio?.connectedAccountId
      )
        throw new Error('The account changed before copying');
      const { id: _id, createdAt: _c, updatedAt: _u, metadata, ...rest } = source;
      const cleanedMetadata = metadata
        ? (() => {
            const { mountedByAgentId: _m, ...restMeta } = metadata;
            return restMeta;
          })()
        : metadata;

      const [created] = await db
        .insert(userConnectors)
        .values({ ...rest, agentId, metadata: cleanedMetadata })
        .returning();

      // Clone the connector's tools (user_connector_tools) onto the new row —
      // otherwise the copy has no callable tools and the runtime resolves nothing.
      const sourceTools = await db
        .select()
        .from(userConnectorTools)
        .where(eq(userConnectorTools.userConnectorId, sourceId));

      if (sourceTools.length > 0) {
        await db.insert(userConnectorTools).values(
          sourceTools.map(({ id: _toolId, createdAt: _tc, updatedAt: _tu, ...toolRest }) => ({
            ...toolRest,
            userConnectorId: created.id,
          })),
        );
      }

      return created;
    };
    return source.metadata?.composio
      ? withNativeConnectorLock(
          this.db,
          source.metadata.composio.linkedByUserId ?? source.userId,
          source.identifier,
          (tx) => copy(tx as LobeChatDatabase, source),
        )
      : copy(this.db, source);
  };

  delete = async (id: string): Promise<void> => {
    const [candidate] = await this.db
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.ownership()))
      .limit(1);
    if (!candidate) return;
    if (!candidate.workspaceId) {
      // Existing web deletion must also retire the explicit selection. Otherwise
      // removing its row would silently select an older agent/plugin account.
      await withNativeConnectorLock(this.db, this.userId, candidate.identifier, async (tx) => {
        const [current] = await tx
          .select()
          .from(userConnectors)
          .where(and(eq(userConnectors.id, id), this.ownership()))
          .limit(1)
          .for('update');
        if (!current) return;
        if (current.identifier !== candidate.identifier)
          throw new Error('The connection changed before deleting');
        const ids = current?.metadata?.nativeAccess?.agentIds;
        if (Array.isArray(ids) && ids.length) {
          const affected = await tx
            .select({ id: agents.id, plugins: agents.plugins })
            .from(agents)
            .where(
              and(
                eq(agents.userId, this.userId),
                isNull(agents.workspaceId),
                inArray(agents.id, ids),
              ),
            )
            .orderBy(agents.id);
          for (const agent of affected)
            await tx
              .update(agents)
              .set({
                plugins: upsertPluginMode(
                  agent.plugins ?? undefined,
                  candidate.identifier,
                  'disabled',
                ) as unknown as string[],
              })
              .where(eq(agents.id, agent.id));
        }
        await tx.delete(userConnectors).where(and(eq(userConnectors.id, id), this.ownership()));
      });
      return;
    }
    await this.db.delete(userConnectors).where(and(eq(userConnectors.id, id), this.ownership()));
  };

  query = async (
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db.select().from(userConnectors).where(this.baseScope());

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Query base-scope connector metadata without selecting or decrypting any
   * credential/OIDC fields. Intended for public API and read-only inventory.
   */
  queryPublic = async (): Promise<PublicConnectorRecord[]> => {
    return this.db.select(this.publicSelection).from(userConnectors).where(this.baseScope());
  };

  /**
   * All connectors that belong to an agent's "Agent Tools" view: agent-OWNED
   * rows (`agent_id = agentId` — Copy / Connect-new) plus base rows MOUNTED by
   * this agent (`metadata.mountedByAgentId = agentId` — Linked). Powers the
   * agent-settings management view (the base {@link query} excludes agent-owned
   * rows; mounted rows still appear there too, flagged as locked).
   */
  queryByAgent = async (
    agentId: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(
        and(
          this.ownership(),
          or(
            eq(userConnectors.agentId, agentId),
            sql`${userConnectors.metadata} ->> 'mountedByAgentId' = ${agentId}`,
          ),
        ),
      );

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * All agent-OWNED connector rows (`agent_id IS NOT NULL`) within the current
   * scope — i.e. every connector that belongs to some agent, across all agents.
   * Powers the unified connector-settings view which lists "which
   * connector is bound to which agent" in one place, instead of one agent at a
   * time via {@link queryByAgent}.
   *
   * Scope-correct by construction: {@link ownership} carries the `workspace_id`
   * predicate, so in a workspace context this only returns rows owned by that
   * workspace's agents and never leaks personal-dimension rows (and vice versa)
   * — the invariant applied to the aggregate view. Mounted/linked
   * base rows (`agent_id IS NULL`) are intentionally excluded; they already show
   * under the base {@link query} list.
   */
  queryAllAgentScoped = async (
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(and(this.ownership(), isNotNull(userConnectors.agentId)));

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Base (non-agent) rows for the given identifiers. Excludes agent-scoped rows;
   * use {@link resolveByIdentifiers} for agent-aware runtime resolution.
   */
  queryByIdentifiers = async (
    identifiers: string[],
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(and(this.baseScope(), inArray(userConnectors.identifier, identifiers)));

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Agent-aware runtime resolution. For each identifier returns at most one
   * connector, preferring the agent-owned row (`agent_id = agentId`) over the
   * base row (Agent > Workspace/Personal). When `agentId` is omitted this is
   * equivalent to {@link queryByIdentifiers} (base rows only).
   *
   * This is the single entry point runtime paths (aiAgent manifest build,
   * connector exec, MCP call gate, Composio account resolution) must use in
   * place of `const [c] = await queryByIdentifiers(...)`, which silently picked
   * an arbitrary row once multiple rows share an identifier.
   */
  resolveByIdentifiers = async (
    identifiers: string[],
    agentId?: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
    options?: { lock?: boolean },
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const query = this.db
      .select()
      .from(userConnectors)
      .where(and(this.scopePredicate(agentId), inArray(userConnectors.identifier, identifiers)));

    const rows = await (options?.lock ? query.for('share') : query);
    return Promise.all(this.pickByPriority(rows, agentId).map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Agent-aware variant of {@link query}: every resolvable connector in the
   * current scope, deduped by identifier with the agent-owned row winning. Used
   * to enumerate connectors for a run (e.g. Composio manifest building) where
   * the agent's own connector should shadow the base one.
   */
  resolveAll = async (
    agentId?: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db.select().from(userConnectors).where(this.scopePredicate(agentId));

    return Promise.all(this.pickByPriority(rows, agentId).map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Exact-scope lookup for write-path idempotency: finds the row for one
   * specific scope — the given agent (`agent_id = agentId`) or, when `agentId`
   * is omitted, the base row (`agent_id IS NULL`). Unlike
   * {@link resolveByIdentifiers} it does NOT fall back across scopes, so
   * creating an agent connector never updates the personal/workspace row and
   * vice versa.
   */
  findScopedByIdentifier = async (
    identifier: string,
    agentId?: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector | null> => {
    const [row] = await this.db
      .select()
      .from(userConnectors)
      .where(
        and(
          this.ownership(),
          eq(userConnectors.identifier, identifier),
          agentId ? eq(userConnectors.agentId, agentId) : isNull(userConnectors.agentId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return decryptRow(row, gateKeeper);
  };

  queryReferencesByIdentifiers = async (identifiers: string[]): Promise<ConnectorReference[]> => {
    if (identifiers.length === 0) return [];

    return this.db
      .select({
        id: userConnectors.id,
        isEnabled: userConnectors.isEnabled,
        status: userConnectors.status,
      })
      .from(userConnectors)
      .where(and(this.baseScope(), inArray(userConnectors.identifier, identifiers)));
  };

  queryComposioReferencesByIdentifiers = async (
    identifiers: string[],
  ): Promise<ComposioConnectorReference[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select({
        id: userConnectors.id,
        isEnabled: userConnectors.isEnabled,
        metadata: userConnectors.metadata,
        status: userConnectors.status,
        userId: userConnectors.userId,
      })
      .from(userConnectors)
      .where(and(this.baseScope(), inArray(userConnectors.identifier, identifiers)));

    return rows.map(toComposioConnectorReference);
  };

  findById = async (
    id: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector | null> => {
    const [row] = await this.db
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.ownership()))
      .limit(1);

    if (!row) return null;
    return decryptRow(row, gateKeeper);
  };

  /**
   * Find connector metadata without selecting or decrypting credentials.
   */
  findPublicById = async (id: string): Promise<PublicConnectorRecord | null> => {
    const [row] = await this.db
      .select(this.publicSelection)
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.ownership()))
      .limit(1);

    return row ?? null;
  };

  update = async (
    id: string,
    patch: UpdateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
    options?: { nativeTransition?: boolean },
  ): Promise<void> => {
    const apply = async (db: LobeChatDatabase, expectedIdentifier?: string) => {
      const [current] = await db
        .select()
        .from(userConnectors)
        .where(and(eq(userConnectors.id, id), this.ownership()))
        .limit(1)
        .for('update');
      if (!current) return;
      if (expectedIdentifier && current.identifier !== expectedIdentifier)
        throw new Error('The connection changed before editing');
      const managed = !!current.metadata && Object.hasOwn(current.metadata, 'nativeAccess');
      let next = { ...patch };
      if (!options?.nativeTransition) {
        if (
          !managed &&
          next.metadata &&
          nativeRuntimeKeys.some((key) => Object.hasOwn(next.metadata!, key))
        )
          throw new Error('Managed connection metadata is reserved for server authorization');
        if (managed) {
          if (
            (next.agentId !== undefined && next.agentId !== current.agentId) ||
            (next.identifier !== undefined && next.identifier !== current.identifier) ||
            (next.metadata &&
              Object.hasOwn(next.metadata, 'mountedByAgentId') &&
              next.metadata.mountedByAgentId !== current.metadata?.mountedByAgentId)
          )
            throw new Error('Managed connections require confirmed agent scope assignment');
          if (next.metadata !== undefined) {
            const metadata = { ...current.metadata, ...next.metadata };
            for (const key of [...nativeRuntimeKeys, 'composio', 'mountedByAgentId'] as const) {
              if (Object.hasOwn(current.metadata!, key))
                metadata[key] = current.metadata![key] as never;
              else delete metadata[key];
            }
            next = { ...next, metadata };
          }
          if (
            (next.isEnabled !== undefined && next.isEnabled !== current.isEnabled) ||
            (next.status !== undefined && next.status !== current.status)
          ) {
            const { nativeReadEvidence: _oldEvidence, ...metadata } =
              next.metadata ?? current.metadata!;
            next = {
              ...next,
              metadata: {
                ...metadata,
                nativeAccess: {
                  ...current.metadata!.nativeAccess!,
                  revision: Math.max(
                    Date.now(),
                    (current.metadata!.nativeAccess?.revision ?? 0) + 1,
                  ),
                },
              },
            };
          }
        }
      }
      const credentials =
        next.credentials !== undefined && next.credentials !== null
          ? await encryptCredentials(next.credentials, gateKeeper)
          : undefined;
      await db
        .update(userConnectors)
        .set({
          ...next,
          ...(credentials !== undefined ? { credentials } : {}),
          updatedAt: sql`greatest(clock_timestamp(), ${userConnectors.updatedAt} + interval '1 millisecond')`,
        })
        .where(and(eq(userConnectors.id, id), this.ownership()));
    };
    // Trusted native transitions already own the provider lock and transaction.
    if (options?.nativeTransition) return apply(this.db);
    const [candidate] = await this.db
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.ownership()))
      .limit(1);
    if (!candidate) return;
    if (!candidate.workspaceId)
      return withNativeConnectorLock(this.db, this.userId, candidate.identifier, (tx) =>
        apply(tx as LobeChatDatabase, candidate.identifier),
      );
    return this.db.transaction((tx) => apply(tx as LobeChatDatabase));
  };

  updateStatus = async (id: string, status: ConnectorStatus): Promise<void> => {
    await this.db
      .update(userConnectors)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(userConnectors.id, id), this.ownership()));
  };

  /**
   * Persists a terminal Composio connection-not-found health failure.
   *
   * Use when:
   * - A provider boundary has confirmed that the remote connection no longer exists
   *
   * Expects:
   * - `id` belongs to this model's user/workspace scope
   * - `connectedAccountId` identifies the remote account that produced the failure
   * - The caller has already normalized provider-specific error semantics
   *
   * Returns:
   * - `true` when a scoped Composio connector was transitioned to FAILED/error
   * - `false` for missing rows or non-Composio connectors
   */
  markComposioConnectionUnavailable = async (
    id: string,
    connectedAccountId: string,
  ): Promise<boolean> => {
    const [connector] = await this.db
      .select({ metadata: userConnectors.metadata })
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.ownership()))
      .limit(1);
    const composio = connector?.metadata?.composio;
    if (!connector || !composio) return false;

    const updated = await this.db
      .update(userConnectors)
      .set({
        metadata: {
          ...connector.metadata,
          composio: { ...composio, status: 'FAILED' },
        },
        status: ConnectorStatus.error,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userConnectors.id, id),
          this.ownership(),
          sql`${userConnectors.metadata}->'composio'->>'connectedAccountId' = ${connectedAccountId}`,
        ),
      )
      .returning({ id: userConnectors.id });

    return updated.length > 0;
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

const toComposioConnectorReference = ({
  id,
  isEnabled,
  metadata,
  status,
  userId,
}: Pick<UserConnectorItem, 'id' | 'isEnabled' | 'metadata' | 'status' | 'userId'>) => {
  const composio = metadata?.composio;
  return {
    ...(composio
      ? {
          composio: {
            appSlug: composio.appSlug,
            connectedAccountId: composio.connectedAccountId,
            ownerUserId: composio.linkedByUserId ?? userId,
            status: composio.status,
          },
        }
      : {}),
    id,
    isEnabled,
    status,
  } satisfies ComposioConnectorReference;
};

async function encryptCredentials(credentials: string, gateKeeper?: GateKeeper): Promise<string> {
  if (!gateKeeper) return credentials;
  return gateKeeper.encrypt(credentials);
}

async function decryptRow(
  row: UserConnectorItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedConnector> {
  if (!row.credentials) return { ...row, credentials: null };

  try {
    const plain = gateKeeper
      ? (await gateKeeper.decrypt(row.credentials)).plaintext
      : row.credentials;
    return { ...row, credentials: JSON.parse(plain) as ConnectorCredentials };
  } catch {
    return { ...row, credentials: null };
  }
}
