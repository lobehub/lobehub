import type { ConnectorVisibility } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import pMap from 'p-map';

import type { ConnectorCredentials, NewUserConnector, UserConnectorItem } from '../schemas';
import { agentEvalDatasets, ConnectorStatus, userConnectors, userConnectorTools } from '../schemas';
import type { LobeChatDatabase } from '../type';
import {
  buildWorkspacePayload,
  buildWorkspaceWhere,
  normalizeWorkspaceId,
} from '../utils/workspace';
import { EvalConnectorUpdateError, normalizeEvalConnectorPatch } from './connectorEval';
import {
  connectorAccessScope,
  connectorAgentConfigScope,
  connectorRunScope,
  type ConnectorRunTarget,
} from './connectorScope';

export type { ConnectorRunTarget } from './connectorScope';

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
  /** An Agent mount makes a base connection unavailable to other executors. */
  mountedByAgentId: string | null;
  name: string;
  sourceType: string;
  status: string;
  updatedAt: Date;
  /** Row creator. Needed for row-level manage checks; never surfaced to API responses. */
  userId: string;
  visibility: ConnectorVisibility;
}

export interface ComposioConnectorReference extends ConnectorReference {
  composio?: {
    appSlug: string;
    connectedAccountId: string;
    ownerUserId: string;
    status: string;
  };
}

/**
 * A Composio account held by the legacy plugin projection
 * (`user_installed_plugins.customParams.composio`).
 */
export interface ComposioPluginMirror {
  connectedAccountId: string;
  identifier: string;
  /**
   * The Composio user entity the projection runs the account as
   * (`linkedByUserId`, else the projection row's user), the same owner the
   * runtime passes to Composio.
   */
  ownerUserId: string;
}

type CreateConnectorParams = Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>;

type UpdateConnectorParams = Partial<
  Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>
>;

export class ConnectorModel {
  private userId: string;
  private db: LobeChatDatabase;
  private gateKeeper?: GateKeeper;
  private workspaceId?: string;
  private evaluationDatasetId?: string;

  static forEvaluation(
    db: LobeChatDatabase,
    userId: string,
    datasetId: string,
    workspaceId?: string,
    gateKeeper?: GateKeeper,
  ) {
    if (!datasetId)
      throw new EvalConnectorUpdateError('A Dataset is required for evaluation connections');
    const model = new ConnectorModel(db, userId, workspaceId, gateKeeper);
    model.evaluationDatasetId = datasetId;
    return model;
  }

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string, gateKeeper?: GateKeeper) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.gateKeeper = gateKeeper;
  }

  private ownership = () =>
    connectorAccessScope(
      this.db,
      { userId: this.userId, workspaceId: this.workspaceId },
      this.evaluationDatasetId,
    );

  /**
   * Base (non-agent) scope: the current user/workspace scope restricted to rows
   * that are NOT bound to a specific agent (`agent_id IS NULL`). Agent-scoped
   * rows are a refinement resolved separately via {@link resolveByIdentifiers} /
   * {@link resolveAll}; base list/lookup methods must not surface them, otherwise
   * an agent connector would leak into personal/workspace management + resolution
   * and collide on identifier.
   */
  private baseScope = () => and(this.ownership(), isNull(userConnectors.agentId));

  /**
   * Base rows an agentless runtime lookup may use. In a workspace that is the
   * shared rows only: a member's private connector serves their private agents
   * and nothing else (not a client-side call without an agent, not a dashboard
   * read another member can see). The management view ({@link baseScope}) also
   * lists the caller's own private rows.
   */
  private sharedBaseScope = () =>
    and(
      this.evaluationDatasetId
        ? this.ownership()
        : connectorRunScope(this.db, { userId: this.userId, workspaceId: this.workspaceId }, {}),
      isNull(userConnectors.agentId),
    );

  /**
   * Deterministic connector order for runtime resolution: by identifier, then id
   * so rows sharing an identifier have a stable tie-break. Resolved connectors
   * drive the order of the model's tool schema array, so they must not follow
   * the physical row order, which changes whenever a row is updated.
   */
  private resolutionOrder = () => [asc(userConnectors.identifier), asc(userConnectors.id)];

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
    mountedByAgentId: sql<string | null>`${userConnectors.metadata} ->> 'mountedByAgentId'`,
    name: userConnectors.name,
    sourceType: userConnectors.sourceType,
    status: userConnectors.status,
    updatedAt: userConnectors.updatedAt,
    userId: userConnectors.userId,
    visibility: userConnectors.visibility,
  };

  /**
   * Candidate rows for agent-aware resolution. The base rows come from
   * {@link connectorRunScope}: a workspace run sees the shared rows, and a
   * private agent's run in its own topic also sees its owner's private and
   * personal rows. On top of that, for an agent:
   * - agent-OWNED rows (`agent_id = agentId`) — the Copy / Connect-new flows;
   * - base rows (`agent_id IS NULL`) that are either MOUNTED by this agent
   *   (`metadata.mountedByAgentId = agentId`, the Linked flow) or free (not
   *   mounted by anyone).
   * A base row mounted (locked) by *another* agent is excluded, so a mounted
   * connector can serve only its one agent. Without an agent, only free base
   * rows are candidates.
   *
   * An evaluation model keeps its own Dataset scope ({@link ownership}).
   */
  private scopePredicate = (target: ConnectorRunTarget) =>
    this.agentNarrowing(
      this.evaluationDatasetId
        ? this.ownership()
        : connectorRunScope(
            this.db,
            { userId: this.userId, workspaceId: this.workspaceId },
            target,
          ),
      target.agentId,
    );

  /** The agent-owned / mounted / free narrowing of {@link scopePredicate} over `base`. */
  private agentNarrowing = (base: SQL | undefined, agentId?: string) => {
    // COALESCE'd to a sentinel rather than null-tested: `->> … IS NULL` in a
    // WHERE clause is one bm25 index on `user_connectors` away from taking every
    // caller down at plan time. See the note on `TopicModel`. `''` is a safe
    // sentinel — a mount reference is always a real agent id, never empty.
    const mountedBy = sql`COALESCE(${userConnectors.metadata} ->> 'mountedByAgentId', '')`;
    // Private Dataset imports are usable only through an exact evaluation binding.
    // Exclude them before priority selection and credential decryption in ordinary chat.
    if (!agentId) {
      return and(base, isNull(userConnectors.agentId), sql`${mountedBy} = ''`);
    }
    return and(
      base,
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
   * Reduce candidate rows to at most one per identifier. Rows are ranked by
   * binding first, then by whose connection it is:
   *
   * 1. binding — agent-OWNED by this agent > MOUNTED by this agent > free base;
   * 2. within a binding — the owner's private row in this workspace > the
   *    owner's personal row > the workspace's shared row. A private agent's
   *    owner chose their own connection for their own agent, so it shadows
   *    the shared one; a row made inside this workspace beats one carried
   *    over from personal space.
   *
   * Equal ranks keep the first row in {@link resolutionOrder} (identifier,
   * then id), so the pick never follows the physical row order. The result
   * drives the order of the model's tool schema array.
   *
   * Only a private agent's run in its own topic can see private or personal
   * rows at all (see {@link connectorRunScope}); every other run only ranks
   * shared rows here.
   */
  private pickByPriority = (rows: UserConnectorItem[], agentId?: string): UserConnectorItem[] => {
    const workspaceId = normalizeWorkspaceId(this.workspaceId);
    const bindingRank = (row: UserConnectorItem): number => {
      if (agentId && row.agentId === agentId) return 2;
      if (agentId && row.metadata?.mountedByAgentId === agentId) return 1;
      return 0;
    };
    const ownershipRank = (row: UserConnectorItem): number => {
      if (!workspaceId) return 0;
      if (row.workspaceId === workspaceId && row.visibility === 'private') return 2;
      if (row.workspaceId === null) return 1;
      return 0;
    };
    const rank = (row: UserConnectorItem) => bindingRank(row) * 3 + ownershipRank(row);
    const byIdentifier = new Map<string, UserConnectorItem>();
    for (const row of rows) {
      const current = byIdentifier.get(row.identifier);
      if (!current || rank(row) > rank(current)) byIdentifier.set(row.identifier, row);
    }
    return [...byIdentifier.values()];
  };

  /**
   * The model for a resolved row's own scope. A private agent's workspace run
   * can resolve its owner's personal rows (`workspace_id IS NULL`), which this
   * workspace-scoped model cannot write; follow-up writes on such a row (a
   * rotated OAuth token, a status change) go through the personal scope.
   * Every other row is already in this model's scope.
   */
  forRow = (
    row: Pick<UserConnectorItem, 'userId' | 'workspaceId'>,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): ConnectorModel => {
    if (
      !this.evaluationDatasetId &&
      normalizeWorkspaceId(this.workspaceId) &&
      row.workspaceId === null &&
      row.userId === this.userId
    ) {
      return new ConnectorModel(this.db, this.userId, undefined, gateKeeper);
    }
    return this;
  };

  create = async (
    params: CreateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<UserConnectorItem> => {
    return this.db.transaction(async (tx) => {
      if (!this.evaluationDatasetId && params.metadata?.agentEval) {
        throw new EvalConnectorUpdateError(
          'Use the Dataset connection API for evaluation connections',
        );
      }
      if (this.evaluationDatasetId) {
        const [dataset] = await tx
          .select({ id: agentEvalDatasets.id })
          .from(agentEvalDatasets)
          .where(
            and(
              eq(agentEvalDatasets.id, this.evaluationDatasetId),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId },
                agentEvalDatasets,
              ),
            ),
          )
          .for('share');
        if (!dataset) throw new EvalConnectorUpdateError('Dataset not found');
        if (params.credentials && !gateKeeper)
          throw new EvalConnectorUpdateError('Secure connection storage is unavailable');
        if (params.agentId || params.metadata?.mountedByAgentId)
          throw new EvalConnectorUpdateError(
            'Evaluation connections cannot be assigned to a normal Agent',
          );
        const marker = params.metadata?.agentEval;
        params = {
          ...params,
          metadata: {
            ...params.metadata,
            agentEval: {
              ...(marker && typeof marker === 'object' && !Array.isArray(marker) ? marker : {}),
              datasetId: this.evaluationDatasetId,
            },
          },
        };
      }
      const credentials = params.credentials
        ? await encryptCredentials(params.credentials, gateKeeper)
        : null;

      const [result] = await tx
        .insert(userConnectors)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { ...params, credentials },
          ),
        )
        .returning();

      return result;
    });
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
    if (!source || source.metadata?.agentEval) return null;

    const { id: _id, createdAt: _c, updatedAt: _u, metadata, ...rest } = source;
    const cleanedMetadata = metadata
      ? (() => {
          const { mountedByAgentId: _m, ...restMeta } = metadata;
          return restMeta;
        })()
      : metadata;

    const [created] = await this.db
      .insert(userConnectors)
      .values({ ...rest, agentId, metadata: cleanedMetadata })
      .returning();

    // Clone the connector's tools (user_connector_tools) onto the new row —
    // otherwise the copy has no callable tools and the runtime resolves nothing.
    const sourceTools = await this.db
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, sourceId));

    if (sourceTools.length > 0) {
      await this.db.insert(userConnectorTools).values(
        sourceTools.map(({ id: _toolId, createdAt: _tc, updatedAt: _tu, ...toolRest }) => ({
          ...toolRest,
          userConnectorId: created.id,
        })),
      );
    }

    return created;
  };

  delete = async (id: string): Promise<void> => {
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
   * Base (non-agent) shared rows for the given identifiers (see
   * {@link sharedBaseScope}). Excludes agent-scoped rows; use
   * {@link resolveByIdentifiers} for agent-aware runtime resolution.
   */
  queryByIdentifiers = async (
    identifiers: string[],
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(and(this.sharedBaseScope(), inArray(userConnectors.identifier, identifiers)))
      .orderBy(...this.resolutionOrder());

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  /**
   * Agent-aware runtime resolution. For each identifier returns at most one
   * connector, ranked by {@link pickByPriority} (agent-owned > mounted > free
   * base, then the owner's private > personal > shared). Without an `agentId`
   * this resolves the free base rows only.
   *
   * `target` decides the base rows (see {@link connectorRunScope}): pass the
   * run's `topicId` so a private agent can load its owner's private
   * connectors; any other caller resolves the workspace's shared ones.
   *
   * This is the single entry point runtime paths (aiAgent manifest build,
   * connector exec, MCP call gate, Composio account resolution) must use in
   * place of `const [c] = await queryByIdentifiers(...)`, which silently picked
   * an arbitrary row once multiple rows share an identifier.
   */
  resolveByIdentifiers = async (
    identifiers: string[],
    target: ConnectorRunTarget = {},
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(and(this.scopePredicate(target), inArray(userConnectors.identifier, identifiers)))
      .orderBy(...this.resolutionOrder());

    return pMap(this.pickByPriority(rows, target.agentId), (r) => decryptRow(r, gateKeeper), {
      concurrency: 5,
    });
  };

  /**
   * Agent-aware variant of {@link query}: every connector the run may resolve,
   * deduped by identifier with {@link pickByPriority}. Used to enumerate
   * connectors for a run (e.g. Composio manifest building) where the agent's
   * own connector should shadow the base one.
   */
  resolveAll = async (
    target: ConnectorRunTarget = {},
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(this.scopePredicate(target))
      .orderBy(...this.resolutionOrder());

    return pMap(this.pickByPriority(rows, target.agentId), (r) => decryptRow(r, gateKeeper), {
      concurrency: 5,
    });
  };

  /**
   * The connectors an agent's configuration may name, one per identifier,
   * ranked as {@link resolveAll} ranks them in the agent's own conversation —
   * without credentials. It needs no topic (see {@link connectorAgentConfigScope}):
   * pinning a plugin id on an agent checks what the agent can load, so an owner
   * can enable their private connector on their private agent. Use it to
   * validate a configuration, never to run a tool.
   */
  queryAvailableForAgent = async (
    agentId?: string,
  ): Promise<Pick<UserConnectorItem, 'identifier' | 'isEnabled' | 'status'>[]> => {
    const base = this.evaluationDatasetId
      ? this.ownership()
      : connectorAgentConfigScope(
          this.db,
          { userId: this.userId, workspaceId: this.workspaceId },
          agentId,
        );
    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(this.agentNarrowing(base, agentId))
      .orderBy(...this.resolutionOrder());

    return this.pickByPriority(rows, agentId).map(({ identifier, isEnabled, status }) => ({
      identifier,
      isEnabled,
      status,
    }));
  };

  /**
   * Exact-scope lookup for write-path idempotency: finds the row for one
   * specific scope — the given agent (`agent_id = agentId`) or, when `agentId`
   * is omitted, the base row (`agent_id IS NULL`). Unlike
   * {@link resolveByIdentifiers} it does NOT fall back across scopes, so
   * creating an agent connector never updates the personal/workspace row and
   * vice versa.
   *
   * In a workspace a base row is looked up within one visibility: the shared
   * row (default), or the caller's own private row. Adding a private
   * connector therefore never rewrites the shared one of the same identifier.
   */
  findScopedByIdentifier = async (
    identifier: string,
    agentId?: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
    visibility: ConnectorVisibility = 'public',
  ): Promise<DecryptedConnector | null> => {
    const sameVisibility =
      !agentId && normalizeWorkspaceId(this.workspaceId)
        ? visibility === 'private'
          ? and(eq(userConnectors.visibility, 'private'), eq(userConnectors.userId, this.userId))
          : eq(userConnectors.visibility, 'public')
        : undefined;
    const [row] = await this.db
      .select()
      .from(userConnectors)
      .where(
        and(
          this.ownership(),
          eq(userConnectors.identifier, identifier),
          agentId ? eq(userConnectors.agentId, agentId) : isNull(userConnectors.agentId),
          sameVisibility,
        ),
      )
      .limit(1);

    if (!row) return null;
    return decryptRow(row, gateKeeper);
  };

  /**
   * The row a connector write should update for this identifier: the caller's
   * binding in ANY visibility. {@link findScopedByIdentifier} pins the lookup to
   * one visibility so a create never rewrites the sibling row; a refresh already
   * owns a row and must find it either way, otherwise switching a connector to
   * private makes the next refresh miss it and create a second, public row for
   * the same account — republishing it to the workspace.
   *
   * A write for a known Composio account (a refresh, a removal) targets the
   * row holding that account: the caller may keep a private row and see a
   * shared one of the same identifier, and the account names which of the two
   * the write is about. An account no row holds is a legacy connection, which
   * lives in the workspace-wide plugin projection: it belongs to the shared
   * scope, so the write targets the shared row (or creates one) under the
   * shared connector policy, and never adopts the account into the caller's
   * private row, where it would vanish from every other member. A new
   * connection (no account yet) prefers the caller's own private row over the
   * shared one, matching {@link pickByPriority}.
   */
  findManageableByIdentifier = async (
    identifier: string,
    agentId?: string,
    composioAccountId?: string,
  ): Promise<{
    agentId: string | null;
    id: string;
    metadata: UserConnectorItem['metadata'];
    userId: string;
    visibility: ConnectorVisibility;
  } | null> => {
    const rows = await this.db
      .select({
        agentId: userConnectors.agentId,
        id: userConnectors.id,
        metadata: userConnectors.metadata,
        userId: userConnectors.userId,
        visibility: userConnectors.visibility,
      })
      .from(userConnectors)
      .where(
        and(
          this.ownership(),
          eq(userConnectors.identifier, identifier),
          agentId ? eq(userConnectors.agentId, agentId) : isNull(userConnectors.agentId),
        ),
      )
      .orderBy(asc(userConnectors.id));

    if (rows.length === 0) return null;
    if (composioAccountId) {
      const holdsAccount = rows.find(
        (row) => row.metadata?.composio?.connectedAccountId === composioAccountId,
      );
      return holdsAccount ?? rows.find((row) => row.visibility !== 'private') ?? null;
    }
    return rows.find((row) => row.visibility === 'private') ?? rows[0];
  };

  /**
   * Every Composio connector row in scope that names this account: in a
   * workspace any member's row, in any visibility and under any identifier,
   * bound to an agent or not; outside a workspace the caller's personal rows.
   *
   * A write naming an account is judged on these rows, never on the identifier
   * it also names. Every member reads the account ids of the workspace-wide
   * plugin projection, so the identifier is theirs to choose, and a lookup
   * keyed by it misses the row that actually runs the account. An account id
   * in a row is no proof of ownership either: a connector's metadata is
   * client-written, so a member can name a teammate's account in a row of
   * their own.
   */
  queryComposioAccountHolders = async (
    composioAccountId: string,
  ): Promise<
    {
      agentId: string | null;
      id: string;
      identifier: string;
      userId: string;
      visibility: ConnectorVisibility;
    }[]
  > => {
    const workspaceId = normalizeWorkspaceId(this.workspaceId);

    return this.db
      .select({
        agentId: userConnectors.agentId,
        id: userConnectors.id,
        identifier: userConnectors.identifier,
        userId: userConnectors.userId,
        visibility: userConnectors.visibility,
      })
      .from(userConnectors)
      .where(
        and(
          workspaceId
            ? eq(userConnectors.workspaceId, workspaceId)
            : and(eq(userConnectors.userId, this.userId), isNull(userConnectors.workspaceId)),
          sql`${userConnectors.metadata} -> 'composio' ->> 'connectedAccountId' = ${composioAccountId}`,
        ),
      )
      .orderBy(asc(userConnectors.id));
  };

  /**
   * Whether a teammate's private connector in this workspace holds this
   * Composio account, under any identifier (see
   * {@link queryComposioAccountHolders}). The legacy plugin projection is
   * workspace-wide, so every member can still read a privatized connection's
   * account id from it; a write naming that account must not reach the
   * account through a row the caller can see instead (deleting the remote
   * account, or copying it onto a shared row). Always false outside a
   * workspace, where nothing is private.
   */
  isComposioAccountPrivateToTeammate = async (composioAccountId: string): Promise<boolean> => {
    if (!normalizeWorkspaceId(this.workspaceId)) return false;

    const holders = await this.queryComposioAccountHolders(composioAccountId);
    return holders.some((row) => row.visibility === 'private' && row.userId !== this.userId);
  };

  /**
   * The plugin-projection accounts that are still legacy connections: no
   * Composio connector row anywhere in this workspace (or, outside a
   * workspace, in the caller's personal scope) is the connector they mirror.
   *
   * Runtime resolution deliberately narrows to what the run may see, so a
   * connection can resolve to nothing while its connector row still exists —
   * a private connector read by someone else, another agent's row. The
   * projection is a mirror of that row, and serving it would resurrect the
   * very connection the run is not allowed to use. A mirror belongs to a
   * Composio row, in any visibility, that:
   *
   * - runs the same account as the same Composio entity
   *   (`linkedByUserId`, else the row creator — what the runtime passes to
   *   Composio), under any identifier and whatever agent it is bound to; or
   * - is a base row of the mirror's identifier created or linked by the
   *   mirror's entity: that user connected this app again, so the account
   *   still in the projection is the connection's past (a reconnect not
   *   finished yet), not a legacy connection to hand to the workspace.
   *
   * Both tests rest on server-owned attribution. The identifier, and an
   * account id alone, prove nothing: any member can add a private connector
   * of a supported identifier without passing the shared connector policy,
   * and write any account id into its metadata (every member reads the
   * projection's account ids), and that row must not take a teammate's
   * legacy connection away from the rest of the workspace. Nor can the
   * projection's own identifier be trusted: a member can file a projection
   * row under any app, copying a teammate's account and entity, and the
   * runtime hands Composio only those two — so the account test spans every
   * identifier, or a privatized connection filed under another app would
   * pass as legacy.
   */
  pickLegacyComposioMirrors = async <T extends ComposioPluginMirror>(
    mirrors: T[],
  ): Promise<T[]> => {
    if (mirrors.length === 0) return [];

    const workspaceId = normalizeWorkspaceId(this.workspaceId);
    // In a workspace the whole workspace counts, including rows other members
    // keep private: the projection is workspace-wide.
    const scope = workspaceId
      ? eq(userConnectors.workspaceId, workspaceId)
      : and(eq(userConnectors.userId, this.userId), isNull(userConnectors.workspaceId));

    const accountId = sql<
      string | null
    >`${userConnectors.metadata} -> 'composio' ->> 'connectedAccountId'`;
    const rows = await this.db
      .select({
        agentId: userConnectors.agentId,
        connectedAccountId: accountId,
        identifier: userConnectors.identifier,
        linkedByUserId: sql<
          string | null
        >`${userConnectors.metadata} -> 'composio' ->> 'linkedByUserId'`,
        userId: userConnectors.userId,
      })
      .from(userConnectors)
      .where(
        and(
          scope,
          or(
            inArray(userConnectors.identifier, [...new Set(mirrors.map((m) => m.identifier))]),
            inArray(accountId, [...new Set(mirrors.map((m) => m.connectedAccountId))]),
          ),
          sql`COALESCE(${accountId}, '') <> ''`,
        ),
      );

    const isMirrorOf = (mirror: ComposioPluginMirror, row: (typeof rows)[number]) =>
      (row.connectedAccountId === mirror.connectedAccountId &&
        (row.linkedByUserId ?? row.userId) === mirror.ownerUserId) ||
      (row.identifier === mirror.identifier &&
        !row.agentId &&
        (row.userId === mirror.ownerUserId || row.linkedByUserId === mirror.ownerUserId));

    return mirrors.filter((mirror) => !rows.some((row) => isMirrorOf(mirror, row)));
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
      .where(and(this.sharedBaseScope(), inArray(userConnectors.identifier, identifiers)));
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
      .where(and(this.sharedBaseScope(), inArray(userConnectors.identifier, identifiers)));

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
  ): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(userConnectors)
        .where(and(eq(userConnectors.id, id), this.ownership()))
        .limit(1)
        .for('update');
      if (!current) return;
      const normalized = await normalizeEvalConnectorPatch(
        current,
        patch,
        gateKeeper?.decrypt.bind(gateKeeper),
      );
      if (current.metadata?.agentEval && normalized.credentials && !gateKeeper) {
        throw new EvalConnectorUpdateError('Secure connection storage is unavailable');
      }
      let credentials: string | undefined;
      if (normalized.credentials !== undefined && normalized.credentials !== null) {
        try {
          credentials = await encryptCredentials(normalized.credentials, gateKeeper);
        } catch (error) {
          if (current.metadata?.agentEval)
            throw new EvalConnectorUpdateError('Could not securely store the mock connection');
          throw error;
        }
      }
      await tx
        .update(userConnectors)
        .set({
          ...normalized,
          ...(credentials !== undefined ? { credentials } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(userConnectors.id, id), this.ownership()));
    });
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
