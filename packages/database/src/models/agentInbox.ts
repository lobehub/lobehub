import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import type { AgentInboxMessageItem, NewAgentInboxMessage } from '../schemas';
import { agentInboxMessages } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** What a caller may supply when a delivery lands in the inbox. */
export interface RecordInboxMessageParams {
  accountId: string;
  agentId: string;
  /** Verification codes already extracted from `text`. */
  codes?: string[];
  from: string;
  kind: AgentInboxMessageItem['kind'];
  metadata?: Record<string, unknown>;
  provider: string;
  providerMessageId: string;
  receivedAt: Date;
  subject?: string | null;
  text: string;
  threadKey?: string | null;
  to: string;
}

export interface RecordInboxMessageResult {
  /** False when the same provider delivery had already been recorded. */
  created: boolean;
  message: AgentInboxMessageItem;
}

/**
 * The agent's own inbox — one row per inbound provider delivery.
 *
 * Storage only: it records, reads and marks read. It never decides whether an
 * inbound is trusted (the account service verifies the signature first) and
 * never wakes the agent (the inbound service owns that). Keeping the model
 * this narrow is what lets the webhook path be idempotent by construction —
 * `(account_id, provider_message_id)` is unique, so a redelivery is a no-op.
 */
export class AgentInboxModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentInboxMessages);

  // --------------- Writes (inbound ingest, unscoped by user) ---------------

  /**
   * Record one inbound delivery. Idempotent: a provider retry whose
   * `providerMessageId` was already stored returns the existing row with
   * `created: false` and writes nothing.
   *
   * This is a **static** write because the inbound path resolves the account
   * before any user is known — the delivery belongs to whoever owns the
   * account, not to the caller of the webhook.
   */
  static record = async (
    db: LobeChatDatabase,
    params: RecordInboxMessageParams,
    scope: { userId: string; workspaceId?: string },
  ): Promise<RecordInboxMessageResult> => {
    const values = buildWorkspacePayload(scope, {
      accountId: params.accountId,
      agentId: params.agentId,
      codes: params.codes ?? [],
      from: params.from,
      kind: params.kind,
      metadata: params.metadata ?? {},
      provider: params.provider,
      providerMessageId: params.providerMessageId,
      receivedAt: params.receivedAt,
      subject: params.subject ?? null,
      text: params.text,
      threadKey: params.threadKey ?? null,
      to: params.to,
    } as NewAgentInboxMessage);

    const [inserted] = await db
      .insert(agentInboxMessages)
      .values(values)
      .onConflictDoNothing({
        target: [agentInboxMessages.accountId, agentInboxMessages.providerMessageId],
      })
      .returning();

    if (inserted) return { created: true, message: inserted };

    // Conflict: somebody (a retry) already stored this delivery. Return the row.
    const [existing] = await db
      .select()
      .from(agentInboxMessages)
      .where(
        and(
          eq(agentInboxMessages.accountId, params.accountId),
          eq(agentInboxMessages.providerMessageId, params.providerMessageId),
        ),
      )
      .limit(1);

    return { created: false, message: existing };
  };

  /**
   * Mark messages read. Scoped to the caller's own rows; an id that is not
   * theirs is silently skipped rather than reported, so the call cannot be
   * used to probe another inbox.
   */
  markRead = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;

    const rows = await this.db
      .update(agentInboxMessages)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(agentInboxMessages.id, ids), this.ownership()))
      .returning({ id: agentInboxMessages.id });

    return rows.length;
  };

  markAllRead = async (agentId: string): Promise<number> => {
    const rows = await this.db
      .update(agentInboxMessages)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(agentInboxMessages.agentId, agentId),
          isNull(agentInboxMessages.readAt),
          this.ownership(),
        ),
      )
      .returning({ id: agentInboxMessages.id });

    return rows.length;
  };

  // --------------- Reads (credential-free, always) ---------------

  list = async (params?: {
    accountId?: string;
    agentId?: string;
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<AgentInboxMessageItem[]> => {
    const conditions = [this.ownership()];
    if (params?.agentId) conditions.push(eq(agentInboxMessages.agentId, params.agentId));
    if (params?.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    if (params?.unreadOnly) conditions.push(isNull(agentInboxMessages.readAt));

    return this.db
      .select()
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(params?.limit ?? 20);
  };

  /**
   * One message by id, scoped to the caller. Ownership is part of the `where`,
   * so an id from someone else's inbox resolves to `undefined` rather than
   * leaking the row's existence.
   */
  findById = async (id: string): Promise<AgentInboxMessageItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  unreadCount = async (agentId: string): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(
        and(
          eq(agentInboxMessages.agentId, agentId),
          isNull(agentInboxMessages.readAt),
          this.ownership(),
        ),
      );

    return row?.value ?? 0;
  };

  /**
   * Messages that arrived on an account at or after `since`, oldest first.
   * Backs the `wait` primitive's poll loop — a wait that started at T only
   * ever sees deliveries the provider stamped at or after T.
   */
  listSince = async (params: {
    accountId?: string;
    agentId: string;
    limit?: number;
    since: Date;
  }): Promise<AgentInboxMessageItem[]> => {
    const conditions = [
      eq(agentInboxMessages.agentId, params.agentId),
      gt(agentInboxMessages.receivedAt, params.since),
      this.ownership(),
    ];
    if (params.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));

    return this.db
      .select()
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(asc(agentInboxMessages.receivedAt))
      .limit(params.limit ?? 10);
  };

  /** Newest N messages for one agent, oldest-last — the context injection read. */
  static latestForAgent = async (
    db: LobeChatDatabase,
    agentId: string,
    limit: number,
  ): Promise<AgentInboxMessageItem[]> => {
    const rows = await db
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.agentId, agentId))
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(limit);

    return rows;
  };

  static unreadCountForAgent = async (db: LobeChatDatabase, agentId: string): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.agentId, agentId), isNull(agentInboxMessages.readAt)));

    return row?.value ?? 0;
  };

  /** Count rows for an account — used by tests and the inbox panel. */
  countForAccount = async (accountId: string): Promise<number> => {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.accountId, accountId), this.ownership()));

    return row?.value ?? 0;
  };
}
