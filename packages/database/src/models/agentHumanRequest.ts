import type { AgentHumanRequestStatus, AgentHumanRequestType } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import type { AgentHumanRequestRow, NewAgentHumanRequest } from '../schemas';
import { agentHumanRequests } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type CreateAgentHumanRequestParams = Omit<
  NewAgentHumanRequest,
  'createdAt' | 'id' | 'status' | 'updatedAt' | 'userId' | 'workspaceId'
>;

/** Outcomes the agent is told about. An expired card never ran, so it is not reported. */
export const AGENT_HUMAN_REQUEST_NOTIFIABLE_STATUSES: AgentHumanRequestStatus[] = [
  'completed',
  'declined',
  'failed',
];

/** Give up waking the agent for one outcome after this many attempts. */
export const AGENT_HUMAN_REQUEST_MAX_NOTIFY_ATTEMPTS = 5;

export interface ListAgentHumanRequestParams {
  agentId?: string;
  limit?: number;
  status?: AgentHumanRequestStatus[];
  topicId?: string;
  type?: AgentHumanRequestType;
}

/**
 * Storage for parked agent actions. Every read and write is scoped to the
 * owner: a request is answered only by the user whose run parked it, never by
 * another member of the same workspace.
 *
 * State changes go through {@link claim}, a conditional update that only moves
 * a row out of the statuses the caller expects. Two concurrent answers (a tap
 * on the phone and a click on the desktop) therefore cannot both run the
 * action: exactly one of them gets the row back.
 */
export class AgentHumanRequestModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    and(
      eq(agentHumanRequests.userId, this.userId),
      this.workspaceId
        ? eq(agentHumanRequests.workspaceId, this.workspaceId)
        : isNull(agentHumanRequests.workspaceId),
    )!;

  create = async (params: CreateAgentHumanRequestParams): Promise<AgentHumanRequestRow> => {
    const [row] = await this.db
      .insert(agentHumanRequests)
      .values({
        ...params,
        status: 'pending',
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning();

    return row;
  };

  findById = async (id: string): Promise<AgentHumanRequestRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentHumanRequests)
      .where(and(eq(agentHumanRequests.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  list = async (params: ListAgentHumanRequestParams = {}): Promise<AgentHumanRequestRow[]> => {
    const conditions = [this.ownership()];
    if (params.agentId) conditions.push(eq(agentHumanRequests.agentId, params.agentId));
    if (params.topicId) conditions.push(eq(agentHumanRequests.topicId, params.topicId));
    if (params.type) conditions.push(eq(agentHumanRequests.type, params.type));
    if (params.status?.length) conditions.push(inArray(agentHumanRequests.status, params.status));

    return this.db
      .select()
      .from(agentHumanRequests)
      .where(and(...conditions))
      .orderBy(desc(agentHumanRequests.createdAt))
      .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));
  };

  /**
   * Move a row from one of `from` to a new state. Returns the updated row, or
   * `undefined` when the row is not the caller's or is no longer in `from` —
   * the caller lost the race and must not perform the action.
   */
  claim = async (
    id: string,
    from: AgentHumanRequestStatus[],
    patch: Partial<Omit<NewAgentHumanRequest, 'id' | 'userId' | 'workspaceId'>>,
  ): Promise<AgentHumanRequestRow | undefined> => {
    const [row] = await this.db
      .update(agentHumanRequests)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(agentHumanRequests.id, id),
          inArray(agentHumanRequests.status, from),
          this.ownership(),
        ),
      )
      .returning();

    return row;
  };

  /**
   * Take the sealed recipient key of a pending secret request **and destroy
   * it in the same transaction**, moving the row to `executing`.
   *
   * ASC requires the key to be consumed before the first decryption attempt
   * (fail closed): whatever happens next — a bad envelope, a crash mid-send —
   * the request can never be opened again. Returns `undefined` when the row is
   * not pending, already consumed, or not the caller's.
   */
  takeRecipientKey = async (
    id: string,
    patch: Partial<Omit<NewAgentHumanRequest, 'id' | 'userId' | 'workspaceId'>> = {},
  ): Promise<{ recipientKey: string; row: AgentHumanRequestRow } | undefined> =>
    this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(agentHumanRequests)
        .where(
          and(
            eq(agentHumanRequests.id, id),
            eq(agentHumanRequests.type, 'secret'),
            eq(agentHumanRequests.status, 'pending'),
            isNotNull(agentHumanRequests.recipientKey),
            this.ownership(),
          ),
        )
        .for('update')
        .limit(1);

      if (!locked?.recipientKey) return undefined;

      const [row] = await tx
        .update(agentHumanRequests)
        .set({ ...patch, recipientKey: null, status: 'executing', updatedAt: new Date() })
        .where(eq(agentHumanRequests.id, id))
        .returning();

      return { recipientKey: locked.recipientKey, row };
    });

  /**
   * Expire every pending request of this owner whose deadline passed, and drop
   * the sealed keys of expired secret requests. Lazy: called on read paths, so
   * no scheduler is needed for the card to show "expired".
   */
  expireDue = async (now: Date = new Date()): Promise<AgentHumanRequestRow[]> =>
    this.db
      .update(agentHumanRequests)
      .set({ recipientKey: null, status: 'expired', updatedAt: now })
      .where(
        and(
          eq(agentHumanRequests.status, 'pending'),
          lt(agentHumanRequests.expiresAt, now),
          this.ownership(),
        ),
      )
      .returning();

  /**
   * Outcomes still owed to the agent: decided, not yet delivered, under the
   * attempt cap, and not claimed by another delivery within `staleMs` (an
   * attempt still in flight is left alone).
   */
  private undelivered = (now: Date, staleMs: number) =>
    and(
      inArray(agentHumanRequests.status, AGENT_HUMAN_REQUEST_NOTIFIABLE_STATUSES),
      isNull(agentHumanRequests.notifiedAt),
      lt(agentHumanRequests.notifyAttempts, AGENT_HUMAN_REQUEST_MAX_NOTIFY_ATTEMPTS),
      or(
        isNull(agentHumanRequests.notifyAttemptedAt),
        lt(agentHumanRequests.notifyAttemptedAt, new Date(now.getTime() - staleMs)),
      ),
      this.ownership(),
    )!;

  /**
   * Claim one delivery attempt of a row's outcome. Conditional, like
   * {@link claim}: two callers racing to redeliver the same outcome get it at
   * most once. Returns `undefined` when there is nothing to deliver.
   */
  claimNotification = async (
    id: string,
    now: Date = new Date(),
    staleMs = 0,
  ): Promise<AgentHumanRequestRow | undefined> => {
    const [row] = await this.db
      .update(agentHumanRequests)
      .set({
        notifyAttemptedAt: now,
        notifyClaimId: crypto.randomUUID(),
        notifyAttempts: sql`${agentHumanRequests.notifyAttempts} + 1`,
      })
      .where(and(eq(agentHumanRequests.id, id), this.undelivered(now, staleMs)))
      .returning();

    return row;
  };

  /**
   * Acknowledge the delivery of the attempt identified by `claimId` (from
   * {@link claimNotification}). A no-op when a newer outcome or attempt has
   * replaced it since — that one is acknowledged by its own claim. Returns
   * whether this attempt's acknowledgement was recorded.
   */
  markNotified = async (id: string, claimId: string, now: Date = new Date()) => {
    const rows = await this.db
      .update(agentHumanRequests)
      .set({ notifiedAt: now, notifyClaimId: null })
      .where(
        and(
          eq(agentHumanRequests.id, id),
          eq(agentHumanRequests.notifyClaimId, claimId),
          isNull(agentHumanRequests.notifiedAt),
          this.ownership(),
        ),
      )
      .returning({ id: agentHumanRequests.id });

    return rows.length > 0;
  };

  /** Ids of this owner's outcomes that a previous wake failed to deliver. */
  listUndelivered = async (now: Date, staleMs: number, limit = 5): Promise<string[]> => {
    const rows = await this.db
      .select({ id: agentHumanRequests.id })
      .from(agentHumanRequests)
      .where(this.undelivered(now, staleMs))
      .orderBy(asc(agentHumanRequests.decidedAt))
      .limit(limit);

    return rows.map((row) => row.id);
  };
}
