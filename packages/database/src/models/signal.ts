import { and, eq } from 'drizzle-orm';

import type { NewSignal, SignalItem } from '../schemas';
import { signals } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type RecordSignalInput = Omit<NewSignal, 'id' | 'userId' | 'workspaceId'>;

/**
 * User-scoped access to the `signals` log. Retention lives in {@link SignalRetentionModel}.
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
}
