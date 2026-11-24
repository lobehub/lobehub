import type { AgentInterventionStatus, AgentOperationStatus } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';

import { AgentInterventionModel } from '@/database/models/agentIntervention';
import { HumanApprovalAlreadyResolvedError, MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { LIVE_OPERATION_STATUSES } from '@/database/models/topic/runningOperation';
import {
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
  topics,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentRuntimeService } from './AgentRuntimeService';

const log = debug('lobe-server:parked-intervention-expiry');

/**
 * How long a run may wait for a human answer before it is ended.
 *
 * Nothing else ever ends such a run: the question card stays `pending`, the
 * operation stays `waiting_for_human`, and the topic stays `waitingForHuman`
 * for as long as nobody answers. Clients older than the polling backoff
 * (lobehub#23745) refetch the whole message page every 2 s while any card is
 * pending, so one open tab on an unanswered question cost ~78 GB of egress a
 * day (T-14797).
 *
 * One day, measured on resolved runtime interventions: the median answer
 * lands within a minute, and only 0.53% of questions / 0.12% of tool
 * approvals were answered after more than a day. Those users find the run
 * interrupted and send again; every extra day of patience costs a full day of
 * polling per open legacy tab.
 */
export const PARKED_INTERVENTION_TTL_MS = 24 * 60 * 60_000;

/** Bound the work of a single tick; a backlog drains over successive ticks. */
const DEFAULT_LIMIT = 50;

/** What the model reads on the next turn in place of the unanswered tool result. */
export const EXPIRED_TOOL_CONTENT =
  'No answer was received in time, so this request expired and the run was stopped.';

/** Statuses meaning a v2 answer is already in flight; such a batch is left alone. */
const ANSWERING_INTERVENTION_STATUSES: AgentInterventionStatus[] = ['resolving', 'published'];

export interface ExpireParkedInterventionsParams {
  limit?: number;
  ttlMs?: number;
}

export interface ExpireParkedInterventionsResult {
  /** A card was answered, or an answer was in flight, while this sweep ran. */
  answered: number;
  examined: number;
  /** Runs ended by this sweep. */
  expired: number;
  /** Candidates whose expiry threw; they stay parked and the next tick retries them. */
  failed: number;
}

type Candidate = Awaited<ReturnType<ParkedInterventionExpiry['listExpired']>>[number];

/**
 * Ends runs parked on a human answer for longer than
 * {@link PARKED_INTERVENTION_TTL_MS}, with the same outcome as the user
 * pressing Stop on the card (`aiAgent.stopPendingApproval`):
 *
 * - every pending card of the run → `aborted`, plus its Cloud v2 intervention
 *   rows → `session_ended`;
 * - the topic → `active`, with `metadata.runningOperation` cleared when it
 *   still names this run;
 * - the operation → `interrupted`;
 * - a group member reports `interrupted` to its supervisor, which otherwise
 *   stays parked on the member barrier.
 *
 * A client polls while a card is pending or the topic looks live, so the next
 * fetch after expiry stops it, legacy clients included.
 *
 * Every step is idempotent and the operation is claimed last, so a tick that
 * fails halfway leaves the row `waiting_for_human` and the next tick finishes
 * it. A user answering at the same moment wins: their claim makes the card
 * update throw `HumanApprovalAlreadyResolvedError`, and the run is left to the
 * continuation.
 *
 * Runtime state in Redis is not touched: it expires two hours after the last
 * step (`AgentStateManager`), long before a run qualifies here.
 */
export class ParkedInterventionExpiry {
  constructor(private readonly db: LobeChatDatabase) {}

  async sweep(params?: ExpireParkedInterventionsParams): Promise<ExpireParkedInterventionsResult> {
    const staleBefore = new Date(Date.now() - (params?.ttlMs ?? PARKED_INTERVENTION_TTL_MS));
    const candidates = await this.listExpired(staleBefore, params?.limit ?? DEFAULT_LIMIT);
    const result: ExpireParkedInterventionsResult = {
      answered: 0,
      examined: candidates.length,
      expired: 0,
      failed: 0,
    };

    for (const candidate of candidates) {
      try {
        result[await this.expire(candidate, staleBefore)] += 1;
      } catch (error) {
        // One poisoned row must not abort the rest of the sweep.
        result.failed += 1;
        console.error('[ParkedInterventionExpiry] %s failed: %O', candidate.id, error);
      }
    }

    log('sweep done: %O', result);
    return result;
  }

  /**
   * Cross-tenant candidate scan, newest first: a run that parked yesterday is
   * the one most likely to still have a tab polling it, so a months-old
   * backlog must not delay it. `created_at` is bounded too so the scan uses
   * `agent_operations_waiting_for_human_created_at_idx` (a parked row's
   * `created_at` is never later than its `updated_at`).
   */
  private listExpired(staleBefore: Date, limit: number) {
    return this.db
      .select({
        createdAt: agentOperations.createdAt,
        id: agentOperations.id,
        /** Durable bridge copy written at start (`createOperation`). */
        isGroupMember: sql<boolean>`coalesce(${agentOperations.metadata} ? 'groupMemberBridge', false)`,
        topicId: agentOperations.topicId,
        userId: agentOperations.userId,
        workspaceId: agentOperations.workspaceId,
      })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.status, 'waiting_for_human'),
          lt(agentOperations.createdAt, staleBefore),
          lt(agentOperations.updatedAt, staleBefore),
        ),
      )
      .orderBy(desc(agentOperations.createdAt))
      .limit(limit);
  }

  private async expire(candidate: Candidate, staleBefore: Date): Promise<'answered' | 'expired'> {
    const { id: operationId, topicId, userId } = candidate;
    const workspaceId = candidate.workspaceId ?? undefined;

    const [answering] = await this.db
      .select({ id: agentInterventions.id })
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, operationId),
          inArray(agentInterventions.status, ANSWERING_INTERVENTION_STATUSES),
        ),
      )
      .limit(1);
    if (answering) return 'answered';

    let answeredByUser = false;
    if (topicId) {
      const cards = await this.listCards(topicId, operationId);
      const pendingIds = cards.filter(({ status }) => status === 'pending').map(({ id }) => id);
      // An approved or rejected card is a user answer. Its continuation is a
      // new operation created before this one is retired, and it inherits the
      // group bridge, so it owns the run from here. Until that operation
      // exists the answer may still be in flight: leave the run alone.
      answeredByUser = cards.some(({ status }) => status !== 'pending' && status !== 'aborted');
      if (answeredByUser && !(await this.hasLaterOperation(candidate))) return 'answered';

      try {
        await new MessageModel(this.db, userId, workspaceId).resolveHumanApproval(
          pendingIds.map((id) => ({
            content: EXPIRED_TOOL_CONTENT,
            id,
            intervention: { status: 'aborted' as const },
          })),
          { publishResult: true },
        );
      } catch (error) {
        if (error instanceof HumanApprovalAlreadyResolvedError) return 'answered';
        throw error;
      }
    }

    const interventionModel = new AgentInterventionModel(this.db, userId, workspaceId);
    for (const batchId of await this.listOpenBatches(operationId)) {
      await interventionModel.markBatchTerminal(operationId, batchId, 'session_ended');
    }

    if (topicId) await this.releaseTopic(candidate);
    if (candidate.isGroupMember && !answeredByUser) await this.reportToSupervisor(candidate);

    // Claimed last so every earlier step is retried while this still holds.
    const claimed = await this.db
      .update(agentOperations)
      .set({ completedAt: new Date(), completionReason: 'interrupted', status: 'interrupted' })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'waiting_for_human'),
          lt(agentOperations.updatedAt, staleBefore),
        ),
      )
      .returning({ id: agentOperations.id });

    if (claimed.length === 0) return 'answered';
    log('[%s] expired parked run on topic %s', operationId, topicId);
    return 'expired';
  }

  /** Every card of this run with its status, located through the topic's messages. */
  private listCards(topicId: string, operationId: string) {
    return this.db
      .select({
        id: messagePlugins.id,
        status: sql<string | null>`${messagePlugins.intervention}->>'status'`,
      })
      .from(messages)
      .innerJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.topicId, topicId),
          eq(messages.role, 'tool'),
          sql`${messagePlugins.intervention}->>'operationId' = ${operationId}`,
        ),
      );
  }

  /** Whether the topic got an operation after this one, e.g. an answer's continuation. */
  private async hasLaterOperation({ createdAt, id, topicId }: Candidate): Promise<boolean> {
    const [later] = await this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topicId!),
          ne(agentOperations.id, id),
          gt(agentOperations.createdAt, createdAt),
        ),
      )
      .limit(1);
    return Boolean(later);
  }

  private async listOpenBatches(operationId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ batchId: agentInterventions.batchId })
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, operationId),
          eq(agentInterventions.status, 'pending'),
        ),
      );
    return rows.map(({ batchId }) => batchId);
  }

  /**
   * Hand the topic back as `active`, unless another live run owns it. The parked
   * status is written by the client, not by `settleRunningOperation` (which
   * only moves a `running` topic), so it is flipped here.
   */
  private async releaseTopic({ id, topicId, userId, workspaceId }: Candidate) {
    await new TopicModel(this.db, userId, workspaceId ?? undefined).settleRunningOperation(
      topicId!,
      id,
      'active',
    );

    // Any other live run keeps the topic, older ones included: an expired
    // child must not release a topic its live root still owns.
    const otherLiveRun = this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topicId!),
          ne(agentOperations.id, id),
          inArray(agentOperations.status, [...LIVE_OPERATION_STATUSES] as AgentOperationStatus[]),
        ),
      );

    await this.db
      .update(topics)
      .set({ status: 'active' })
      .where(
        and(
          eq(topics.id, topicId!),
          eq(topics.status, 'waitingForHuman'),
          sql`NOT EXISTS (${otherLiveRun})`,
        ),
      );
  }

  /**
   * Same report as Stop sends (`stopPendingApproval`). Sent before the claim
   * so a failure leaves the run parked and the next tick reports again; the
   * bridge is idempotent (CAS-guarded backfill and resume), so a repeat is
   * safe. The run's cards are already aborted here, so no answer can move it.
   */
  private async reportToSupervisor({ id, userId, workspaceId }: Candidate) {
    const runtime = new AgentRuntimeService(this.db, userId, {
      workspaceId: workspaceId ?? undefined,
    });
    const member = await runtime.loadGroupMemberBridge(id);
    if (!member) return;
    await runtime.completeGroupActionMember({
      ...member.bridge,
      operationId: id,
      reason: 'interrupted',
    });
  }
}
