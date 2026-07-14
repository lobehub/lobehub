import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type {
  ConnectorCredentials,
  ConnectorStatus,
  NewUserConnector,
  UserConnectorItem,
} from '../schemas';
import { userConnectors, userConnectorTools } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedConnector extends Omit<UserConnectorItem, 'credentials'> {
  credentials: ConnectorCredentials | null;
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
    const mountedBy = sql`${userConnectors.metadata} ->> 'mountedByAgentId'`;
    if (!agentId) {
      return and(this.ownership(), isNull(userConnectors.agentId), sql`${mountedBy} IS NULL`);
    }
    return and(
      this.ownership(),
      or(
        eq(userConnectors.agentId, agentId),
        and(
          isNull(userConnectors.agentId),
          or(sql`${mountedBy} = ${agentId}`, sql`${mountedBy} IS NULL`),
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
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(and(this.scopePredicate(agentId), inArray(userConnectors.identifier, identifiers)));

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

  update = async (
    id: string,
    patch: UpdateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<void> => {
    const credentials =
      patch.credentials !== undefined && patch.credentials !== null
        ? await encryptCredentials(patch.credentials, gateKeeper)
        : undefined;

    const set = {
      ...patch,
      ...(credentials !== undefined ? { credentials } : {}),
      updatedAt: new Date(),
    };

    await this.db
      .update(userConnectors)
      .set(set)
      .where(and(eq(userConnectors.id, id), this.ownership()));
  };

  updateStatus = async (id: string, status: ConnectorStatus): Promise<void> => {
    await this.db
      .update(userConnectors)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(userConnectors.id, id), this.ownership()));
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

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
