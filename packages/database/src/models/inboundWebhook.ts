import type { InboundWebhookState, InboundWebhookStatus } from '@lobechat/types';
import {
  INBOUND_WEBHOOK_DELIVERY_ERRORS,
  INBOUND_WEBHOOK_ERRORS,
  INBOUND_WEBHOOK_STATUSES,
  InboundWebhookDataSchema,
  McpEventsWebhookStateSchema,
} from '@lobechat/types';
import { and, count, desc, eq, getTableColumns, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { InboundWebhookRow, NewInboundWebhook } from '../schemas';
import { inboundWebhooks, topics, users } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface InboundWebhookGateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export type InboundWebhookView = Omit<InboundWebhookRow, 'secret'>;
export type CreateInboundWebhook = Omit<NewInboundWebhook, 'userId' | 'workspaceId'>;
export type InboundWebhookPatch = Partial<
  Pick<
    InboundWebhookRow,
    'status' | 'name' | 'nextMaintenanceAt' | 'maintenanceFailures' | 'lastDeliveryAt' | 'lastError'
  >
>;

export interface InboundWebhookQuery {
  agentId?: string;
  connectorId?: string;
  includeHidden?: boolean;
  topicId?: string;
}

export class InboundWebhookLimitError extends Error {
  readonly code = 'limit_reached';

  constructor(scope: 'topic' | 'user') {
    super(`Inbound webhook ${scope} subscription limit reached`);
    this.name = 'InboundWebhookLimitError';
  }
}

const patchSchema = z
  .object({
    status: z.enum(INBOUND_WEBHOOK_STATUSES).optional(),
    name: z.string().nullable().optional(),
    nextMaintenanceAt: z.date().nullable().optional(),
    maintenanceFailures: z.number().int().nonnegative().optional(),
    lastDeliveryAt: z.date().nullable().optional(),
    lastError: z.enum(INBOUND_WEBHOOK_ERRORS).nullable().optional(),
  })
  .strict();

const { secret: _secret, ...viewColumns } = getTableColumns(inboundWebhooks);

const validateView = (row: InboundWebhookView): InboundWebhookView => {
  InboundWebhookDataSchema.parse(row);
  return row;
};

const toView = ({ secret: _ciphertext, ...row }: InboundWebhookRow) => validateView(row);

/** Workspace reads are shared; row-level mutation permission belongs to the resource router. */
export class InboundWebhookModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    private gateKeeper?: InboundWebhookGateKeeper,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, inboundWebhooks);

  private requireGateKeeper = () => {
    if (!this.gateKeeper) {
      throw new Error(
        'InboundWebhookModel needs a gatekeeper (KEY_VAULTS_SECRET) to store or read secrets',
      );
    }
    return this.gateKeeper;
  };

  private prepare = async (input: CreateInboundWebhook) => {
    const data = InboundWebhookDataSchema.parse({ ...input, state: input.state ?? {} });
    return buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        ...input,
        ...data,
        secret: input.secret == null ? null : await this.requireGateKeeper().encrypt(input.secret),
      },
    );
  };

  private insert = async (
    db: LobeChatDatabase | Transaction,
    payload: Awaited<ReturnType<InboundWebhookModel['prepare']>>,
  ) => {
    const [row] = await db.insert(inboundWebhooks).values(payload).returning();
    return toView(row);
  };

  create = async (input: CreateInboundWebhook): Promise<InboundWebhookView> =>
    this.insert(this.db, await this.prepare(input));

  /** Parent-row locks serialize both creator and topic quotas, including pending/deleting rows. */
  createWithLimits = async (
    input: CreateInboundWebhook,
    limits = { topic: 10, user: 50 },
  ): Promise<InboundWebhookView> => {
    const payload = await this.prepare(input);
    return this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, this.userId)).for('update');
      if (input.topicId) {
        await tx
          .select({ id: topics.id })
          .from(topics)
          .where(eq(topics.id, input.topicId))
          .for('update');
      }
      const [userCount] = await tx
        .select({ count: count() })
        .from(inboundWebhooks)
        .where(eq(inboundWebhooks.userId, this.userId));
      if (userCount.count >= limits.user) throw new InboundWebhookLimitError('user');
      if (input.topicId) {
        const [topicCount] = await tx
          .select({ count: count() })
          .from(inboundWebhooks)
          .where(eq(inboundWebhooks.topicId, input.topicId));
        if (topicCount.count >= limits.topic) throw new InboundWebhookLimitError('topic');
      }
      return this.insert(tx, payload);
    });
  };

  query = async (filter: InboundWebhookQuery = {}): Promise<InboundWebhookView[]> => {
    const rows = await this.db
      .select(viewColumns)
      .from(inboundWebhooks)
      .where(
        and(
          this.ownership(),
          filter.topicId ? eq(inboundWebhooks.topicId, filter.topicId) : undefined,
          filter.agentId ? eq(inboundWebhooks.agentId, filter.agentId) : undefined,
          filter.connectorId ? eq(inboundWebhooks.connectorId, filter.connectorId) : undefined,
          filter.includeHidden
            ? undefined
            : inArray(inboundWebhooks.status, ['active', 'error', 'terminated']),
        ),
      )
      .orderBy(desc(inboundWebhooks.createdAt));
    return rows.map(validateView);
  };

  findById = async (id: string): Promise<InboundWebhookView | undefined> => {
    const [row] = await this.db
      .select(viewColumns)
      .from(inboundWebhooks)
      .where(and(this.ownership(), eq(inboundWebhooks.id, id)))
      .limit(1);
    return row ? validateView(row) : undefined;
  };

  update = async (
    id: string,
    patch: InboundWebhookPatch,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = patchSchema.parse(patch);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set(parsed)
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          parsed.status && parsed.status !== 'deleting'
            ? ne(inboundWebhooks.status, 'deleting')
            : undefined,
        ),
      )
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  /** Apply an in-flight result only while the persisted lifecycle still allows it. */
  updateIfStatus = async (
    id: string,
    patch: InboundWebhookPatch,
    statuses: InboundWebhookStatus[],
    state?: Partial<InboundWebhookState>,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = patchSchema.parse(patch);
    const statePatch = state === undefined ? undefined : McpEventsWebhookStateSchema.parse(state);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({
        ...parsed,
        ...(statePatch
          ? {
              state: sql`${inboundWebhooks.state} || ${JSON.stringify(statePatch)}::jsonb`,
            }
          : {}),
      })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          inArray(inboundWebhooks.status, statuses),
        ),
      )
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  /**
   * Record a real event delivery. Control envelopes (gap, terminated) are not events: they
   * neither move "last event" nor prove that event delivery works.
   *
   * Clears only delivery failures, using current database values so concurrent auth/runtime
   * errors survive.
   */
  recordDelivery = async (id: string, isEvent: boolean): Promise<void> => {
    if (!isEvent) return;
    const recovered = and(
      eq(inboundWebhooks.status, 'error'),
      inArray(inboundWebhooks.lastError, [...INBOUND_WEBHOOK_DELIVERY_ERRORS]),
    );
    await this.db
      .update(inboundWebhooks)
      .set({
        lastDeliveryAt: new Date(),
        status: sql`CASE WHEN ${recovered} THEN 'active' ELSE ${inboundWebhooks.status} END`,
        lastError: sql`CASE WHEN ${recovered} THEN NULL ELSE ${inboundWebhooks.lastError} END`,
      })
      .where(and(this.ownership(), eq(inboundWebhooks.id, id)));
  };

  /** Each caller patches only its owned keys, never overwrites a concurrently advanced cursor. */
  mergeState = async (
    id: string,
    patch: Partial<InboundWebhookState>,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = McpEventsWebhookStateSchema.parse(patch);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({ state: sql`${inboundWebhooks.state} || ${JSON.stringify(parsed)}::jsonb` })
      .where(and(this.ownership(), eq(inboundWebhooks.id, id)))
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  /** Compare the JSON keys a caller observed while merging only its owned state keys. */
  mergeStateIf = async (
    id: string,
    patch: Partial<InboundWebhookState>,
    expected: Partial<InboundWebhookState>,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = McpEventsWebhookStateSchema.parse(patch);
    McpEventsWebhookStateSchema.parse(expected);
    const comparisons = Object.entries(expected).map(([key, value]) => {
      const observed = value === undefined ? sql`NULL` : sql`${JSON.stringify(value)}::jsonb`;
      return sql`(${inboundWebhooks.state} -> ${key}::text) IS NOT DISTINCT FROM ${observed}`;
    });
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({ state: sql`${inboundWebhooks.state} || ${JSON.stringify(parsed)}::jsonb` })
      .where(and(this.ownership(), eq(inboundWebhooks.id, id), ...comparisons))
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  delete = async (id: string): Promise<void> => {
    await this.db.delete(inboundWebhooks).where(and(this.ownership(), eq(inboundWebhooks.id, id)));
  };

  getSecret = async (id: string): Promise<string | null> => {
    const [row] = await this.db
      .select({ secret: inboundWebhooks.secret })
      .from(inboundWebhooks)
      .where(and(this.ownership(), eq(inboundWebhooks.id, id)))
      .limit(1);
    if (!row?.secret) return null;
    return (await this.requireGateKeeper().decrypt(row.secret)).plaintext;
  };

  /** Reserve one wake atomically, resetting the rolling hourly bucket when it expires. */
  reserveWake = async (id: string, limit = 30): Promise<string | undefined> => {
    const now = new Date();
    const reset = sql`${inboundWebhooks.wakeWindowStartedAt} <= ${new Date(now.getTime() - 3_600_000)}`;
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({
        wakeCount: sql`CASE WHEN ${reset} THEN 1 ELSE ${inboundWebhooks.wakeCount} + 1 END`,
        wakeWindowStartedAt: sql`CASE WHEN ${reset} THEN ${now} ELSE ${inboundWebhooks.wakeWindowStartedAt} END`,
      })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          sql`(${reset} OR ${inboundWebhooks.wakeCount} < ${limit})`,
        ),
      )
      // Preserve PostgreSQL timestamp precision; a JS Date would truncate microseconds.
      .returning({ window: sql<string>`${inboundWebhooks.wakeWindowStartedAt}::text` });
    return row?.window;
  };

  /** Return a reservation when execution never started; retries must not spend the wake quota. */
  releaseWake = async (id: string, window: string): Promise<void> => {
    await this.db
      .update(inboundWebhooks)
      .set({ wakeCount: sql`greatest(0, ${inboundWebhooks.wakeCount} - 1)` })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          sql`${inboundWebhooks.wakeWindowStartedAt} = ${window}::timestamptz`,
        ),
      );
  };

  /** Inbound routing is intentionally unscoped, then secrets are explicitly decrypted. */
  static findForDelivery = async (
    db: LobeChatDatabase,
    id: string,
    gateKeeper?: InboundWebhookGateKeeper | (() => Promise<InboundWebhookGateKeeper>),
  ): Promise<{ row: InboundWebhookView; secret: string | null } | undefined> => {
    const [row] = await db
      .select()
      .from(inboundWebhooks)
      .where(eq(inboundWebhooks.id, id))
      .limit(1);
    if (!row || row.status === 'deleting') return undefined;
    // Unknown retired kinds must stop delivery rather than throw from their absent parser.
    if (!InboundWebhookDataSchema.safeParse(row).success) return undefined;
    if (!row.secret) return { row: toView(row), secret: null };
    const resolvedGateKeeper = typeof gateKeeper === 'function' ? await gateKeeper() : gateKeeper;
    if (!resolvedGateKeeper) {
      throw new Error(
        'InboundWebhookModel needs a gatekeeper (KEY_VAULTS_SECRET) to store or read secrets',
      );
    }
    return { row: toView(row), secret: (await resolvedGateKeeper.decrypt(row.secret)).plaintext };
  };

  static queryMaintenance = async (
    db: LobeChatDatabase,
    limit = 100,
  ): Promise<InboundWebhookView[]> => {
    const rows = await db
      .select(viewColumns)
      .from(inboundWebhooks)
      .where(
        and(
          lte(inboundWebhooks.nextMaintenanceAt, new Date()),
          inArray(inboundWebhooks.status, ['active', 'error', 'deleting']),
        ),
      )
      .orderBy(inboundWebhooks.nextMaintenanceAt)
      .limit(limit);
    return rows.map(validateView);
  };

  static queryStalePending = async (db: LobeChatDatabase): Promise<InboundWebhookView[]> => {
    const rows = await db
      .select(viewColumns)
      .from(inboundWebhooks)
      .where(
        and(
          eq(inboundWebhooks.status, 'pending'),
          lt(inboundWebhooks.createdAt, new Date(Date.now() - 600_000)),
        ),
      )
      .limit(100);
    return rows.map(validateView);
  };
}
