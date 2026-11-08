import { and, eq, sql } from 'drizzle-orm';

import type { NewSignal, SignalItem } from '../schemas';
import { signals } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload } from '../utils/workspace';

export type RecordSignalInput = Omit<NewSignal, 'id' | 'userId' | 'workspaceId'>;

export interface RecordSignalParams {
  accountId?: string | null;
  agentId?: string | null;
  externalId: string;
  occurredAt?: Date | null;
  payload: Record<string, unknown>;
  source: string;
  type: string;
}

export interface RecordSignalResult {
  /** False when the source had already delivered this event. */
  created: boolean;
  signal: SignalItem;
}

/**
 * Access to the `signals` log. Retention lives in {@link SignalRetentionModel}.
 *
 * Instances are user-scoped. The static methods are the inbound edge's writes:
 * a delivery is recorded before any user is known (it belongs to whoever owns
 * the account it was addressed to), so they are unscoped and keyed by the
 * signal's id or its `(source, external_id)`. Nothing here interprets a
 * signal: callers record it, then report how processing ended.
 */
export class SignalModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Stores one signal, or returns the row a previous delivery already stored.
   *
   * Idempotent on `(source, external_id)`. A key that already belongs to another user resolves to
   * `undefined` instead of leaking that user's row.
   */
  record = async (input: RecordSignalInput): Promise<SignalItem | undefined> => {
    const [inserted] = await this.db
      .insert(signals)
      .values({ ...input, userId: this.userId, workspaceId: this.workspaceId })
      .onConflictDoNothing({ target: [signals.source, signals.externalId] })
      .returning();

    if (inserted) return inserted;

    return this.findByExternalId(input.source, input.externalId);
  };

  findByExternalId = async (source: string, externalId: string) => {
    const [row] = await this.db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.source, source),
          eq(signals.externalId, externalId),
          eq(signals.userId, this.userId),
        ),
      )
      .limit(1);

    return row;
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(signals)
      .where(and(eq(signals.id, id), eq(signals.userId, this.userId)))
      .limit(1);

    return row;
  };

  // ── inbound edge (unscoped) ──
  /**
   * Record one authenticated event. Idempotent: a redelivery of the same
   * `(source, external_id)` returns the stored row with `created: false`, so the
   * caller can tell a retry of a failed signal from a first delivery.
   */
  static record = async (
    db: LobeChatDatabase,
    params: RecordSignalParams,
    scope: { userId: string; workspaceId?: string },
  ): Promise<RecordSignalResult> => {
    const values = buildWorkspacePayload(scope, {
      accountId: params.accountId ?? null,
      agentId: params.agentId ?? null,
      externalId: params.externalId,
      occurredAt: params.occurredAt ?? null,
      payload: params.payload,
      source: params.source,
      type: params.type,
    } as NewSignal);

    const [inserted] = await db
      .insert(signals)
      .values(values)
      .onConflictDoNothing({ target: [signals.source, signals.externalId] })
      .returning();
    if (inserted) return { created: true, signal: inserted };

    const [existing] = await db
      .select()
      .from(signals)
      .where(and(eq(signals.source, params.source), eq(signals.externalId, params.externalId)))
      .limit(1);

    return { created: false, signal: existing };
  };

  /** Processing produced what the signal was for (a mail, an inbox item, a wake). */
  static markProcessed = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await SignalModel.settle(db, id, { error: null, status: 'processed' });
  };

  /** Authentic, but deliberately produced nothing; `reason` says why. */
  static markIgnored = async (db: LobeChatDatabase, id: string, reason: string): Promise<void> => {
    await SignalModel.settle(db, id, { error: reason, status: 'ignored' });
  };

  /** Processing failed; the signal stays for a retry or a look. */
  static markFailed = async (db: LobeChatDatabase, id: string, error: string): Promise<void> => {
    await SignalModel.settle(db, id, { error, status: 'failed' });
  };

  /** End one processing attempt: record its outcome and count it. */
  private static settle = async (
    db: LobeChatDatabase,
    id: string,
    outcome: { error: string | null; status: SignalItem['status'] },
  ): Promise<void> => {
    await db
      .update(signals)
      .set({
        attempts: sql`${signals.attempts} + 1`,
        error: outcome.error,
        processedAt: outcome.status === 'failed' ? null : new Date(),
        status: outcome.status,
        updatedAt: new Date(),
      })
      .where(eq(signals.id, id));
  };
}
