import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, sql } from 'drizzle-orm';

import type { AgentInboxMessageItem, NewAgentInboxMessage } from '../schemas';
import { agentInboxMessages } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
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

  /**
   * Workspace scope AND the owning agent's visibility: the inbox holds whatever
   * outsiders sent the agent — verification codes included — so a workspace
   * member must not read a colleague's private agent's mail.
   */
  private ownership = () => {
    const ctx = { userId: this.userId, workspaceId: this.workspaceId };

    return and(
      buildWorkspaceWhere(ctx, agentInboxMessages),
      agentUsableBy(this.db, agentInboxMessages.agentId, ctx),
    )!;
  };

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
   * The topic an earlier wake on this thread ran in, if any. Unscoped like
   * {@link record}: the waker learns the account from the webhook, before any
   * user is known, and the thread belongs to that account's owner.
   */
  static findThreadTopicId = async (
    db: LobeChatDatabase,
    params: { accountId: string; threadKey: string },
  ): Promise<string | undefined> => {
    const [row] = await db
      .select({ topicId: sql<string | null>`${agentInboxMessages.metadata}->>'topicId'` })
      .from(agentInboxMessages)
      .where(
        and(
          eq(agentInboxMessages.accountId, params.accountId),
          eq(agentInboxMessages.threadKey, params.threadKey),
          sql`${agentInboxMessages.metadata} ? 'topicId'`,
        ),
      )
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(1);

    return row?.topicId ?? undefined;
  };

  /**
   * Take the right to wake this delivery. Atomic across instances: the row is
   * stamped only while it is unread and unclaimed, so when two webhook workers
   * process the same delivery concurrently exactly one of them starts a run.
   * Returns whether this caller won.
   */
  static claimWake = async (db: LobeChatDatabase, id: string): Promise<boolean> => {
    const rows = await db
      .update(agentInboxMessages)
      .set({
        metadata: sql`coalesce(${agentInboxMessages.metadata}, '{}'::jsonb) || jsonb_build_object('wakeClaimedAt', now())`,
      })
      .where(
        and(
          eq(agentInboxMessages.id, id),
          isNull(agentInboxMessages.readAt),
          sql`not (coalesce(${agentInboxMessages.metadata}, '{}'::jsonb) ? 'wakeClaimedAt')`,
        ),
      )
      .returning({ id: agentInboxMessages.id });

    return rows.length > 0;
  };

  /** Give a wake claim back after the wake failed, so the provider's retry can wake it. */
  static releaseWake = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(agentInboxMessages)
      .set({ metadata: sql`coalesce(${agentInboxMessages.metadata}, '{}'::jsonb) - 'wakeClaimedAt'` })
      .where(eq(agentInboxMessages.id, id));
  };

  /**
   * Stamp a delivery whose wake started: the run received its content, so it is
   * read, and the topic it ran in is remembered so its thread can continue there.
   */
  static markWoken = async (
    db: LobeChatDatabase,
    id: string,
    topicId: string | undefined,
  ): Promise<void> => {
    await db
      .update(agentInboxMessages)
      .set({
        metadata: topicId
          ? sql`coalesce(${agentInboxMessages.metadata}, '{}'::jsonb) || ${JSON.stringify({ topicId })}::jsonb`
          : undefined,
        readAt: sql`coalesce(${agentInboxMessages.readAt}, now())`,
      })
      .where(eq(agentInboxMessages.id, id));
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
    /** Only messages received at or after this instant. */
    receivedAfter?: Date;
    threadKey?: string;
    unreadOnly?: boolean;
  }): Promise<AgentInboxMessageItem[]> => {
    const conditions = [this.ownership()];
    if (params?.agentId) conditions.push(eq(agentInboxMessages.agentId, params.agentId));
    if (params?.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    if (params?.threadKey) conditions.push(eq(agentInboxMessages.threadKey, params.threadKey));
    if (params?.receivedAfter)
      conditions.push(gte(agentInboxMessages.receivedAt, params.receivedAfter));
    if (params?.unreadOnly) conditions.push(isNull(agentInboxMessages.readAt));

    return this.db
      .select()
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(params?.limit ?? 20);
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
    /** Exact sender address. */
    from?: string;
    limit?: number;
    since: Date;
    /** Case-insensitive substring of the subject. */
    subjectIncludes?: string;
  }): Promise<AgentInboxMessageItem[]> => {
    const conditions = [
      eq(agentInboxMessages.agentId, params.agentId),
      // Local ingestion time, not the provider's clock: a delivery whose
      // reported receivedAt predates the cursor (webhook delay, clock skew)
      // still arrived after it and must be seen by the poll.
      gt(agentInboxMessages.createdAt, params.since),
      this.ownership(),
    ];
    if (params.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    // Filters run in the query, not on the fetched page: filtering after
    // `limit` would keep re-reading the same oldest non-matching rows.
    if (params.from) conditions.push(eq(agentInboxMessages.from, params.from));
    if (params.subjectIncludes) {
      const pattern = `%${params.subjectIncludes.replaceAll(/[%_\\]/g, '\\$&')}%`;
      conditions.push(ilike(agentInboxMessages.subject, pattern));
    }

    return this.db
      .select()
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(asc(agentInboxMessages.createdAt))
      .limit(params.limit ?? 10);
  };

  /**
   * The newest message from someone other than `recipient`, received at or
   * after `since`, whose extracted codes include any of `candidates`. Runs over
   * the whole window in one query so a flood of later mail cannot push the
   * message carrying the code out of a fetched page.
   */
  findCodeFromOtherSender = async (params: {
    agentId: string;
    candidates: string[];
    recipient: string;
    since: Date;
  }): Promise<AgentInboxMessageItem | undefined> => {
    if (params.candidates.length === 0) return undefined;

    const [row] = await this.db
      .select()
      .from(agentInboxMessages)
      .where(
        and(
          this.ownership(),
          eq(agentInboxMessages.agentId, params.agentId),
          gte(agentInboxMessages.receivedAt, params.since),
          sql`lower(trim(${agentInboxMessages.from})) <> ${params.recipient}`,
          sql`coalesce(${agentInboxMessages.codes}, '[]'::jsonb) ?| ${sql.raw('ARRAY[')}${sql.join(
            params.candidates.map((candidate) => sql`${candidate}`),
            sql`, `,
          )}${sql.raw(']::text[]')}`,
        ),
      )
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(1);

    return row;
  };

  static unreadCountForAgent = async (db: LobeChatDatabase, agentId: string): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.agentId, agentId), isNull(agentInboxMessages.readAt)));

    return row?.value ?? 0;
  };

  /**
   * How many deliveries an account received at or after `since`, optionally
   * from one sender. Unscoped like {@link record}: the inbound edge uses it to
   * rate-limit wakes before any user is known.
   */
  static countRecent = async (
    db: LobeChatDatabase,
    params: { accountId: string; from?: string; since: Date },
  ): Promise<number> => {
    const conditions = [
      eq(agentInboxMessages.accountId, params.accountId),
      gte(agentInboxMessages.createdAt, params.since),
    ];
    if (params.from) conditions.push(eq(agentInboxMessages.from, params.from));

    const [row] = await db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(and(...conditions));

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
