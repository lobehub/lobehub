import type { AgentInboxSourceType, AgentMailAttachment } from '@lobechat/types';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type { AgentInboxMessageItem, NewAgentInboxMessage } from '../schemas';
import { agentInboxMessages, agentMails } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** What the inbound edge supplies when an item lands in the inbox. */
export interface DeliverInboxItemParams {
  accountId?: string | null;
  agentId: string;
  preview?: string | null;
  receivedAt: Date;
  sender: string;
  sourceId: string;
  sourceType: AgentInboxSourceType;
  threadKey?: string | null;
  title?: string | null;
}

export interface DeliverInboxItemResult {
  /** False when this source record was already in the inbox. */
  created: boolean;
  item: AgentInboxMessageItem;
}

/**
 * One inbox item together with the content of the record it points at — what
 * the account tool, the wake prompt and the detail view read. The inbox owns
 * the state (`readAt`, `topicId`, …); the content comes from the source (for
 * `mail`: the `agent_mails` row).
 */
export interface AgentInboxEntry {
  accountId: string | null;
  agentId: string;
  attachments: AgentMailAttachment[];
  codes: string[];
  createdAt: Date;
  /** Who it is from (the inbox's `sender`). */
  from: string;
  id: string;
  /** RFC `Message-ID` of the mail, for threading a reply. */
  messageId: string | null;
  preview: string | null;
  /** The provider's id for the content, for provider-side replies. */
  providerMessageId: string | null;
  readAt: Date | null;
  receivedAt: Date;
  sourceId: string;
  sourceType: AgentInboxSourceType;
  /** The item's title (a mail's subject). */
  subject: string | null;
  text: string;
  threadKey: string | null;
  /** Where it was delivered (the agent's own address). */
  to: string;
  topicId: string | null;
}

/**
 * How long a wake claim holds. Starting a run returns once its operation
 * exists, so a live wake finishes in seconds; ten minutes only ever expires on
 * a worker that died holding the claim.
 */
export const WAKE_CLAIM_LEASE_SECONDS = 10 * 60;

const mailOfItem = and(
  eq(agentInboxMessages.sourceType, 'mail'),
  eq(agentMails.id, agentInboxMessages.sourceId),
);

const entryColumns = {
  accountId: agentInboxMessages.accountId,
  agentId: agentInboxMessages.agentId,
  attachments: sql<AgentMailAttachment[]>`coalesce(${agentMails.attachments}, '[]'::jsonb)`,
  codes: sql<string[]>`coalesce(${agentMails.codes}, '[]'::jsonb)`,
  createdAt: agentInboxMessages.createdAt,
  from: agentInboxMessages.sender,
  id: agentInboxMessages.id,
  messageId: agentMails.messageId,
  preview: agentInboxMessages.preview,
  providerMessageId: agentMails.providerMessageId,
  readAt: agentInboxMessages.readAt,
  receivedAt: agentInboxMessages.receivedAt,
  sourceId: agentInboxMessages.sourceId,
  sourceType: agentInboxMessages.sourceType,
  subject: agentInboxMessages.title,
  text: sql<string>`coalesce(${agentMails.text}, '')`,
  threadKey: agentInboxMessages.threadKey,
  to: sql<string>`coalesce(${agentMails.to}->0->>'address', '')`,
  topicId: agentInboxMessages.topicId,
};

/** Who, what and when — the inbox's own columns, none of the source's content. */
const summaryColumns = {
  accountId: agentInboxMessages.accountId,
  agentId: agentInboxMessages.agentId,
  createdAt: agentInboxMessages.createdAt,
  from: agentInboxMessages.sender,
  id: agentInboxMessages.id,
  preview: agentInboxMessages.preview,
  readAt: agentInboxMessages.readAt,
  receivedAt: agentInboxMessages.receivedAt,
  sourceType: agentInboxMessages.sourceType,
  subject: agentInboxMessages.title,
  threadKey: agentInboxMessages.threadKey,
};

/**
 * The agent's inbox — one row per item that arrived for its attention.
 *
 * Storage only: it delivers, reads and marks state. It never decides whether
 * an arrival is trusted (the account service verifies the signature first)
 * and never wakes the agent (the inbound service owns that). Content lives in
 * the source record; reads that need it join through {@link entryColumns}.
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

  private selectEntries = () =>
    this.db.select(entryColumns).from(agentInboxMessages).leftJoin(agentMails, mailOfItem);

  // --------------- Writes (inbound ingest, unscoped by user) ---------------

  /**
   * Put one source record in the inbox. Idempotent: a record that is already
   * there returns its item with `created: false` and writes nothing.
   *
   * Static because the inbound edge resolves the account before any user is
   * known — the item belongs to whoever owns the account.
   */
  static deliver = async (
    db: LobeChatDatabase,
    params: DeliverInboxItemParams,
    scope: { userId: string; workspaceId?: string },
  ): Promise<DeliverInboxItemResult> => {
    const values = buildWorkspacePayload(scope, {
      accountId: params.accountId ?? null,
      agentId: params.agentId,
      preview: params.preview ?? null,
      receivedAt: params.receivedAt,
      sender: params.sender,
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      threadKey: params.threadKey ?? null,
      title: params.title ?? null,
    } as NewAgentInboxMessage);

    const [inserted] = await db
      .insert(agentInboxMessages)
      .values(values)
      .onConflictDoNothing({
        target: [agentInboxMessages.sourceType, agentInboxMessages.sourceId],
      })
      .returning();
    if (inserted) return { created: true, item: inserted };

    const [existing] = await db
      .select()
      .from(agentInboxMessages)
      .where(
        and(
          eq(agentInboxMessages.sourceType, params.sourceType),
          eq(agentInboxMessages.sourceId, params.sourceId),
        ),
      )
      .limit(1);

    return { created: false, item: existing };
  };

  /** One item with its content, unscoped — for the inbound edge and the waker. */
  static findEntry = async (
    db: LobeChatDatabase,
    id: string,
  ): Promise<AgentInboxEntry | undefined> => {
    const [row] = await db
      .select(entryColumns)
      .from(agentInboxMessages)
      .leftJoin(agentMails, mailOfItem)
      .where(eq(agentInboxMessages.id, id))
      .limit(1);

    return row;
  };

  /**
   * The topic an earlier wake on this thread ran in, if any. Unscoped like
   * {@link deliver}: the waker learns the account from the webhook.
   */
  static findThreadTopicId = async (
    db: LobeChatDatabase,
    params: { accountId: string; threadKey: string },
  ): Promise<string | undefined> => {
    const [row] = await db
      .select({ topicId: agentInboxMessages.topicId })
      .from(agentInboxMessages)
      .where(
        and(
          eq(agentInboxMessages.accountId, params.accountId),
          eq(agentInboxMessages.threadKey, params.threadKey),
          isNotNull(agentInboxMessages.topicId),
        ),
      )
      .orderBy(desc(agentInboxMessages.receivedAt))
      .limit(1);

    return row?.topicId ?? undefined;
  };

  /**
   * Take the right to wake this item. Atomic across instances: it is stamped
   * only while unread and unclaimed, so when two webhook workers process the
   * same delivery concurrently exactly one of them starts a run.
   *
   * The claim is a lease: a claim older than {@link WAKE_CLAIM_LEASE_SECONDS}
   * on a still-unread item — left by a worker that died — can be taken over. A
   * wake that succeeds marks the item read, so a finished wake never repeats.
   */
  static claimWake = async (db: LobeChatDatabase, id: string): Promise<boolean> => {
    const rows = await db
      .update(agentInboxMessages)
      .set({ wakeClaimedAt: sql`now()` })
      .where(
        and(
          eq(agentInboxMessages.id, id),
          isNull(agentInboxMessages.readAt),
          or(
            isNull(agentInboxMessages.wakeClaimedAt),
            lt(
              agentInboxMessages.wakeClaimedAt,
              sql`now() - make_interval(secs => ${WAKE_CLAIM_LEASE_SECONDS})`,
            ),
          ),
        ),
      )
      .returning({ id: agentInboxMessages.id });

    return rows.length > 0;
  };

  /** Give a wake claim back after the wake failed, so the provider's retry can wake it. */
  static releaseWake = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(agentInboxMessages)
      .set({ wakeClaimedAt: null })
      .where(eq(agentInboxMessages.id, id));
  };

  /**
   * Stamp an item whose wake started: the run received its content, so it is
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
        readAt: sql`coalesce(${agentInboxMessages.readAt}, now())`,
        ...(topicId ? { topicId } : {}),
      })
      .where(eq(agentInboxMessages.id, id));
  };

  /**
   * Mark items read. Scoped to the caller's own rows; an id that is not theirs
   * is silently skipped rather than reported, so the call cannot be used to
   * probe another inbox.
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

  /**
   * Record that a wait in `operationId` handed this item to the model, so the
   * same run's next wait moves on to the next arrival. Kept apart from `readAt`:
   * an item read elsewhere (a wake, `readInbox`) must still satisfy a wait.
   */
  markWaitConsumed = async (id: string, operationId: string): Promise<void> => {
    await this.db
      .update(agentInboxMessages)
      .set({
        updatedAt: new Date(),
        waitConsumedBy: sql`${agentInboxMessages.waitConsumedBy} || to_jsonb(${operationId}::text)`,
      })
      .where(and(eq(agentInboxMessages.id, id), this.ownership()));
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

  /** Items with their content, newest first. */
  list = async (params?: {
    accountId?: string;
    agentId?: string;
    /**
     * Keyset cursor for newest-first paging: only items strictly older than
     * this (receivedAt, id) pair, so pages never overlap or skip an item that
     * shares a timestamp.
     */
    before?: { id: string; receivedAt: Date };
    limit?: number;
    /** Only items received at or after this instant. */
    receivedAfter?: Date;
    threadKey?: string;
    unreadOnly?: boolean;
  }): Promise<AgentInboxEntry[]> => {
    const conditions = [this.ownership()];
    if (params?.before) {
      const { id, receivedAt } = params.before;
      conditions.push(
        or(
          lt(agentInboxMessages.receivedAt, receivedAt),
          and(eq(agentInboxMessages.receivedAt, receivedAt), lt(agentInboxMessages.id, id)),
        )!,
      );
    }
    if (params?.agentId) conditions.push(eq(agentInboxMessages.agentId, params.agentId));
    if (params?.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    if (params?.threadKey) conditions.push(eq(agentInboxMessages.threadKey, params.threadKey));
    if (params?.receivedAfter)
      conditions.push(gte(agentInboxMessages.receivedAt, params.receivedAfter));
    if (params?.unreadOnly) conditions.push(isNull(agentInboxMessages.readAt));

    return this.selectEntries()
      .where(and(...conditions))
      .orderBy(desc(agentInboxMessages.receivedAt), desc(agentInboxMessages.id))
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

  /**
   * The same page as {@link list}, without the content: who, what and when, plus
   * the short preview the inbox stores itself. A list view renders only these,
   * and a page of long mails would otherwise be transferred — and held — just
   * to draw their subject lines. The full item is one {@link list} or detail
   * read away.
   */
  listSummaries = async (params?: Parameters<AgentInboxModel['list']>[0]) => {
    const conditions = [this.ownership()];
    if (params?.before) {
      const { id, receivedAt } = params.before;
      conditions.push(
        or(
          lt(agentInboxMessages.receivedAt, receivedAt),
          and(eq(agentInboxMessages.receivedAt, receivedAt), lt(agentInboxMessages.id, id)),
        )!,
      );
    }
    if (params?.agentId) conditions.push(eq(agentInboxMessages.agentId, params.agentId));
    if (params?.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    if (params?.threadKey) conditions.push(eq(agentInboxMessages.threadKey, params.threadKey));
    if (params?.receivedAfter)
      conditions.push(gte(agentInboxMessages.receivedAt, params.receivedAfter));
    if (params?.unreadOnly) conditions.push(isNull(agentInboxMessages.readAt));

    return this.db
      .select(summaryColumns)
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(desc(agentInboxMessages.receivedAt), desc(agentInboxMessages.id))
      .limit(params?.limit ?? 20);
  };

  /** One item with its content, scoped to the caller. */
  findEntryById = async (id: string): Promise<AgentInboxEntry | undefined> => {
    const [row] = await this.selectEntries()
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
   * Items that arrived at or after `since`, oldest first, with their content.
   * Backs the `wait` primitive's poll loop.
   */
  listSince = async (params: {
    accountId?: string;
    agentId: string;
    /** Exact sender address. */
    from?: string;
    limit?: number;
    /** Skip items a wait in this operation already returned (see {@link markWaitConsumed}). */
    notConsumedBy?: string;
    since: Date;
    /** Case-insensitive substring of the title (a mail's subject). */
    subjectIncludes?: string;
  }): Promise<AgentInboxEntry[]> => {
    const conditions = [
      eq(agentInboxMessages.agentId, params.agentId),
      // Local ingestion time, not the source's clock: an item whose reported
      // receivedAt predates the cursor (webhook delay, clock skew) still arrived
      // after it and must be seen by the poll.
      gt(agentInboxMessages.createdAt, params.since),
      this.ownership(),
    ];
    if (params.accountId) conditions.push(eq(agentInboxMessages.accountId, params.accountId));
    // Filters run in the query, not on the fetched page: filtering after
    // `limit` would keep re-reading the same oldest non-matching rows.
    if (params.from) conditions.push(eq(agentInboxMessages.sender, params.from));
    if (params.notConsumedBy) {
      conditions.push(sql`not (${agentInboxMessages.waitConsumedBy} ? ${params.notConsumedBy})`);
    }
    if (params.subjectIncludes) {
      const pattern = `%${params.subjectIncludes.replaceAll(/[%_\\]/g, '\\$&')}%`;
      conditions.push(ilike(agentInboxMessages.title, pattern));
    }

    return this.selectEntries()
      .where(and(...conditions))
      .orderBy(asc(agentInboxMessages.createdAt))
      .limit(params.limit ?? 10);
  };

  static unreadCountForAgent = async (db: LobeChatDatabase, agentId: string): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.agentId, agentId), isNull(agentInboxMessages.readAt)));

    return row?.value ?? 0;
  };

  /**
   * How many items an account received at or after `since`, optionally from
   * one sender. Unscoped like {@link deliver}: the inbound edge uses it to
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
    if (params.from) conditions.push(eq(agentInboxMessages.sender, params.from));

    const [row] = await db
      .select({ value: count() })
      .from(agentInboxMessages)
      .where(and(...conditions));

    return row?.value ?? 0;
  };

  /** Count items for an account — used by tests and the inbox panel. */
  countForAccount = async (accountId: string): Promise<number> => {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(agentInboxMessages)
      .where(and(eq(agentInboxMessages.accountId, accountId), this.ownership()));

    return row?.value ?? 0;
  };
}

/** One inbox item as a list shows it. */
export type AgentInboxSummaryRow = Awaited<ReturnType<AgentInboxModel['listSummaries']>>[number];
