import type { SignalDecisionLabel, SignalDecisionLabelMetadata } from '@lobechat/types';
import { and, asc, desc, eq } from 'drizzle-orm';

import type { NewSignalDecision, SignalDecisionItem, SignalDecisionLabelItem } from '../schemas';
import { signalDecisionLabels, signalDecisions, signals } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type RecordSignalDecisionInput = Omit<
  NewSignalDecision,
  'agentId' | 'id' | 'userId' | 'workspaceId'
> & {
  /**
   * Required on purpose. `agent_id` is nullable only because deleting an agent clears it
   * (`ON DELETE SET NULL`); a decision is always made by one agent, and the idempotency key
   * `(signal_id, agent_id, pipeline_version)` cannot hold for a missing one.
   */
  agentId: string;
};

export interface AddSignalDecisionLabelInput {
  actor?: string;
  confidence?: number;
  label: SignalDecisionLabel;
  metadata?: SignalDecisionLabelMetadata;
  /** Who produced the label: `user`, `heuristic`, `llm_judge`, … */
  source: string;
}

/**
 * User-scoped access to `signal_decisions` and their append-only `signal_decision_labels`.
 */
export class SignalDecisionModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Records what the pipeline decided for one signal.
   *
   * Idempotent on `(signal_id, agent_id, pipeline_version)`: a redelivered message returns the
   * decision already stored for the same agent instead of adding a second one. Returns `undefined` when the signal
   * does not belong to this user.
   */
  record = async (input: RecordSignalDecisionInput): Promise<SignalDecisionItem | undefined> => {
    if (!input.agentId) throw new Error('A signal decision needs the agent that made it');

    const [owned] = await this.db
      .select({ id: signals.id })
      .from(signals)
      .where(and(eq(signals.id, input.signalId), eq(signals.userId, this.userId)))
      .limit(1);

    if (!owned) return undefined;

    const [inserted] = await this.db
      .insert(signalDecisions)
      .values({ ...input, userId: this.userId, workspaceId: this.workspaceId })
      .onConflictDoNothing({
        target: [
          signalDecisions.signalId,
          signalDecisions.agentId,
          signalDecisions.pipelineVersion,
        ],
      })
      .returning();

    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(signalDecisions)
      .where(
        and(
          eq(signalDecisions.signalId, input.signalId),
          eq(signalDecisions.userId, this.userId),
          eq(signalDecisions.agentId, input.agentId),
          eq(signalDecisions.pipelineVersion, input.pipelineVersion),
        ),
      )
      .limit(1);

    return existing;
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(signalDecisions)
      .where(and(eq(signalDecisions.id, id), eq(signalDecisions.userId, this.userId)))
      .limit(1);

    return row;
  };

  listBySignal = async (signalId: string) =>
    this.db
      .select()
      .from(signalDecisions)
      .where(and(eq(signalDecisions.signalId, signalId), eq(signalDecisions.userId, this.userId)))
      .orderBy(asc(signalDecisions.createdAt));

  /** Links the decision to the run it started. The only field a decision gets after the fact. */
  linkRun = async (id: string, run: { operationId?: string; topicId?: string }) => {
    const [row] = await this.db
      .update(signalDecisions)
      .set({ operationId: run.operationId, topicId: run.topicId })
      .where(and(eq(signalDecisions.id, id), eq(signalDecisions.userId, this.userId)))
      .returning();

    return row;
  };

  /**
   * Appends a label. Never edits or replaces an earlier one; returns `undefined` when the
   * decision is not this user's.
   */
  addLabel = async (
    decisionId: string,
    input: AddSignalDecisionLabelInput,
  ): Promise<SignalDecisionLabelItem | undefined> => {
    if (!(await this.findById(decisionId))) return undefined;

    const [row] = await this.db
      .insert(signalDecisionLabels)
      .values({ ...input, decisionId })
      .returning();

    return row;
  };

  /** Labels newest first. */
  listLabels = async (decisionId: string): Promise<SignalDecisionLabelItem[]> => {
    if (!(await this.findById(decisionId))) return [];

    return this.db
      .select()
      .from(signalDecisionLabels)
      .where(eq(signalDecisionLabels.decisionId, decisionId))
      .orderBy(desc(signalDecisionLabels.createdAt), desc(signalDecisionLabels.id));
  };
}
