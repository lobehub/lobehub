import type {
  InboundWebhookConfig,
  InboundWebhookData,
  InboundWebhookInsert,
  InboundWebhookKind,
  InboundWebhookRow,
  InboundWebhookState,
  InboundWebhookStatus,
} from '@lobechat/types';
import {
  INBOUND_WEBHOOK_DELIVERY_ERRORS,
  INBOUND_WEBHOOK_ERRORS,
  INBOUND_WEBHOOK_KIND_SCHEMAS,
  INBOUND_WEBHOOK_KINDS,
  INBOUND_WEBHOOK_RUN_ERRORS,
  INBOUND_WEBHOOK_STATUSES,
  InboundWebhookDataSchema,
} from '@lobechat/types';
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import { inboundWebhooks, topics, users, workspaceMembers, workspaces } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface InboundWebhookGateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

type InboundWebhookCommonColumns = Omit<
  InboundWebhookRow,
  'secret' | 'kind' | 'config' | 'state' | 'verification'
>;
/** A row without its secret, narrowed by `kind` to that kind's config, state and verification. */
export type InboundWebhookView = InboundWebhookCommonColumns & InboundWebhookData;
export type InboundWebhookViewOf<K extends InboundWebhookKind> = Extract<
  InboundWebhookView,
  { kind: K }
>;
export type CreateInboundWebhook = Omit<InboundWebhookInsert, 'userId' | 'workspaceId'>;

export type InboundWebhookPatch = Partial<
  Pick<
    InboundWebhookRow,
    | 'status'
    | 'name'
    | 'instructions'
    | 'nextMaintenanceAt'
    | 'maintenanceFailures'
    | 'lastDeliveryAt'
    | 'lastError'
  >
> & {
  /** Replaces the whole config; applies only to rows whose kind accepts it. */
  config?: InboundWebhookConfig;
};

export interface InboundWebhookQuery {
  agentId?: string;
  connectorId?: string;
  includeHidden?: boolean;
  kind?: InboundWebhookKind;
  topicId?: string;
}

export class InboundWebhookLimitError extends Error {
  readonly code = 'limit_reached';

  constructor(scope: 'topic' | 'user' | 'workspace') {
    super(`Inbound webhook ${scope} subscription limit reached`);
    this.name = 'InboundWebhookLimitError';
  }
}

const patchSchema = z
  .object({
    status: z.enum(INBOUND_WEBHOOK_STATUSES).optional(),
    name: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),
    nextMaintenanceAt: z.date().nullable().optional(),
    maintenanceFailures: z.number().int().nonnegative().optional(),
    lastDeliveryAt: z.date().nullable().optional(),
    lastError: z.enum(INBOUND_WEBHOOK_ERRORS).nullable().optional(),
  })
  .strict();

const { secret: _secret, ...viewColumns } = getTableColumns(inboundWebhooks);

const validateView = (row: Omit<InboundWebhookRow, 'secret'>): InboundWebhookView => {
  InboundWebhookDataSchema.parse(row);
  return row as InboundWebhookView;
};

const toView = ({ secret: _ciphertext, ...row }: InboundWebhookRow) => validateView(row);

/**
 * The kinds whose schema for `column` accepts `value`, and the value as that schema parsed it
 * (unknown nested fields stripped). A partial update is then limited to rows of those kinds, so an
 * MCP state patch can never land on a generic row or the other way round.
 */
const parseForKinds = (
  column: 'config' | 'state',
  value: unknown,
): { kinds: InboundWebhookKind[]; value: unknown } => {
  const accepted = INBOUND_WEBHOOK_KINDS.flatMap((kind) => {
    const result = INBOUND_WEBHOOK_KIND_SCHEMAS[kind][column].safeParse(value);
    return result.success ? [{ kind, value: result.data }] : [];
  });
  if (!accepted.length) throw new Error(`Invalid inbound webhook ${column} patch`);
  return { kinds: accepted.map((entry) => entry.kind), value: accepted[0].value };
};

const VISIBLE_STATUSES: InboundWebhookStatus[] = ['active', 'error', 'terminated', 'paused'];

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

  /**
   * Parent-row locks serialize the creator, workspace and topic quotas, including pending and
   * deleting rows. All kinds count together. A creator has `user` rows in each scope (personal, or
   * one workspace); a workspace has `perMember` rows for each active member.
   */
  createWithLimits = async (
    input: CreateInboundWebhook,
    limits = { perMember: 50, topic: 10, user: 50 },
  ): Promise<InboundWebhookView> => {
    const payload = await this.prepare(input);
    return this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, this.userId)).for('update');
      if (this.workspaceId) {
        await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, this.workspaceId))
          .for('update');
        const [workspaceCount] = await tx
          .select({ count: count() })
          .from(inboundWebhooks)
          .where(eq(inboundWebhooks.workspaceId, this.workspaceId));
        const members = await InboundWebhookModel.activeMemberCount(
          tx as unknown as LobeChatDatabase,
          this.workspaceId,
        );
        if (workspaceCount.count >= limits.perMember * Math.max(1, members))
          throw new InboundWebhookLimitError('workspace');
      }
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
        .where(
          and(
            eq(inboundWebhooks.userId, this.userId),
            this.workspaceId
              ? eq(inboundWebhooks.workspaceId, this.workspaceId)
              : isNull(inboundWebhooks.workspaceId),
          ),
        );
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
          filter.kind ? eq(inboundWebhooks.kind, filter.kind) : undefined,
          filter.includeHidden ? undefined : inArray(inboundWebhooks.status, VISIBLE_STATUSES),
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
    { config, ...patch }: InboundWebhookPatch,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = patchSchema.parse(patch);
    const configPatch = config === undefined ? undefined : parseForKinds('config', config);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({
        ...parsed,
        ...(configPatch ? { config: configPatch.value as InboundWebhookConfig } : {}),
      })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          configPatch ? inArray(inboundWebhooks.kind, configPatch.kinds) : undefined,
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
    const statePatch = state === undefined ? undefined : parseForKinds('state', state);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({
        ...parsed,
        ...(statePatch
          ? {
              state: sql`${inboundWebhooks.state} || ${JSON.stringify(statePatch.value)}::jsonb`,
            }
          : {}),
      })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          inArray(inboundWebhooks.status, statuses),
          statePatch ? inArray(inboundWebhooks.kind, statePatch.kinds) : undefined,
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

  /**
   * Record that a wake started a run: the wake cap and credit errors no longer hold. Any other
   * error, including one written concurrently, stays.
   */
  recordRunStarted = async (id: string): Promise<void> => {
    await this.db
      .update(inboundWebhooks)
      .set({ lastError: null })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          inArray(inboundWebhooks.lastError, [...INBOUND_WEBHOOK_RUN_ERRORS]),
        ),
      );
  };

  /** Each caller patches only its owned keys, never overwrites a concurrently advanced cursor. */
  mergeState = async (
    id: string,
    patch: Partial<InboundWebhookState>,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = parseForKinds('state', patch);
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({ state: sql`${inboundWebhooks.state} || ${JSON.stringify(parsed.value)}::jsonb` })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          inArray(inboundWebhooks.kind, parsed.kinds),
        ),
      )
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  /** Compare the JSON keys a caller observed while merging only its owned state keys. */
  mergeStateIf = async (
    id: string,
    patch: Partial<InboundWebhookState>,
    expected: Partial<InboundWebhookState>,
  ): Promise<InboundWebhookView | undefined> => {
    const parsed = parseForKinds('state', patch);
    const expectedKinds = parseForKinds('state', expected).kinds;
    const kinds = parsed.kinds.filter((kind) => expectedKinds.includes(kind));
    const comparisons = Object.entries(expected).map(([key, value]) => {
      const observed = value === undefined ? sql`NULL` : sql`${JSON.stringify(value)}::jsonb`;
      return sql`(${inboundWebhooks.state} -> ${key}::text) IS NOT DISTINCT FROM ${observed}`;
    });
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({ state: sql`${inboundWebhooks.state} || ${JSON.stringify(parsed.value)}::jsonb` })
      .where(
        and(
          this.ownership(),
          eq(inboundWebhooks.id, id),
          inArray(inboundWebhooks.kind, kinds),
          ...comparisons,
        ),
      )
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

  /** Replace the secret; the old one stops authenticating as soon as this commits. */
  rotateSecret = async (id: string, secret: string): Promise<InboundWebhookView | undefined> => {
    const [row] = await this.db
      .update(inboundWebhooks)
      .set({ secret: await this.requireGateKeeper().encrypt(secret) })
      .where(
        and(this.ownership(), eq(inboundWebhooks.id, id), ne(inboundWebhooks.status, 'deleting')),
      )
      .returning(viewColumns);
    return row ? validateView(row) : undefined;
  };

  /** Reserve one wake atomically, resetting the rolling hourly bucket when it expires. */
  /**
   * Reserve one run in the webhook's window (`windowMs`, ten minutes by default); undefined once
   * `limit` runs started in it. Returns the window it counted in, for {@link releaseWake}.
   */
  reserveWake = async (
    id: string,
    limit = 30,
    windowMs = 10 * 60_000,
  ): Promise<string | undefined> => {
    const now = new Date();
    const reset = sql`${inboundWebhooks.wakeWindowStartedAt} <= ${new Date(now.getTime() - windowMs)}`;
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

  /**
   * Rows due for maintenance, earliest first. `after` continues from the last row of a previous
   * page, so a caller that skips rows can still reach the ones behind them.
   */
  static queryMaintenance = async (
    db: LobeChatDatabase,
    limit = 100,
    after?: { id: string; nextMaintenanceAt: Date },
  ): Promise<InboundWebhookView[]> => {
    const rows = await db
      .select(viewColumns)
      .from(inboundWebhooks)
      .where(
        and(
          lte(inboundWebhooks.nextMaintenanceAt, new Date()),
          inArray(inboundWebhooks.status, ['active', 'error', 'deleting']),
          after
            ? or(
                gt(inboundWebhooks.nextMaintenanceAt, after.nextMaintenanceAt),
                and(
                  eq(inboundWebhooks.nextMaintenanceAt, after.nextMaintenanceAt),
                  gt(inboundWebhooks.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(inboundWebhooks.nextMaintenanceAt, inboundWebhooks.id)
      .limit(limit);
    return rows.map(validateView);
  };

  /**
   * Push still-due rows to `until`, for rows a sweep cannot act on yet (their owner switched the
   * feature off), so they stop filling the front of every scan. A row someone rescheduled since,
   * or one being deleted, is left alone.
   */
  static deferMaintenance = async (
    db: LobeChatDatabase,
    ids: string[],
    until: Date,
  ): Promise<void> => {
    if (!ids.length) return;
    await db
      .update(inboundWebhooks)
      .set({ nextMaintenanceAt: until })
      .where(
        and(
          inArray(inboundWebhooks.id, ids),
          inArray(inboundWebhooks.status, ['active', 'error']),
          lte(inboundWebhooks.nextMaintenanceAt, new Date()),
        ),
      );
  };

  /** Members of the workspace who have not left it. */
  static activeMemberCount = async (db: LobeChatDatabase, workspaceId: string): Promise<number> => {
    const [row] = await db
      .select({ count: count() })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)),
      );
    return row?.count ?? 0;
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
