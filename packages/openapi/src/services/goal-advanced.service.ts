import type { LobeChatDatabase } from '@/database/type';
import { goalRouter } from '@/server/routers/lambda/goal';
import { graphForClient } from '@/server/services/goal/graphCompat';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import type {
  AddGoalEdgeRequest,
  AddGoalNodeRequest,
  AnswerGoalClarificationsRequest,
  DecideGoalRequest,
  GoalDecisionListQuery,
  GoalEventListQuery,
  GoalObservation,
  RecordGoalObservationRequest,
  RemoveGoalEdgeQuery,
  RetireGoalNodesRequest,
  SetGoalMetricsRequest,
  UpdateGoalConfigRequest,
} from '../types/goal-advanced.type';
import { GoalRestService } from './goal.service';

/**
 * REST service for driving a goal after creation: configuration, hand edits to
 * its graph, the event feed, decision gates and clarifications, measured
 * acceptance clauses and closing it.
 *
 * Each call checks the goal is addressable by the caller (`requireGoal`, the
 * same personal-scope boundary the other goal endpoints keep), then runs the
 * `goal` tRPC procedure the goal page and `lh goal` call — invoked server-side
 * without API-key scopes, since the REST route already narrowed the key. The
 * procedures own the creator-or-owner rule on destructive edits, the draft-only
 * edge removal, the ended-goal guard on decisions and the follow-up advance.
 */
export class GoalAdvancedRestService extends GoalRestService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get goals() {
    return goalRouter.createCaller({ userId: this.userId, workspaceId: this.workspaceId });
  }

  private scheduleAdvance(goalId: string, trigger: 'observe') {
    return scheduleGoalAdvance({
      goalId,
      trigger,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  // ==================== Configuration ====================

  /** Patch the requirement, budget, agents and models together; see `applyConfig`. */
  async updateConfig(id: string, input: UpdateGoalConfigRequest) {
    const reassignedTaskIds = await this.applyConfig(id, input);
    return { graph: await this.goalService.graph(id), reassignedTaskIds };
  }

  // ==================== Graph ====================

  async getGraph(id: string, capabilities?: string[]) {
    await this.requireGoal(id);
    return graphForClient(await this.goalService.graph(id), capabilities);
  }

  async addNode(id: string, input: AddGoalNodeRequest) {
    await this.requireGoal(id);
    const { data } = await this.goals.addNode({ ...input, id });
    return data;
  }

  async retireNodes(id: string, input: RetireGoalNodesRequest) {
    await this.requireGoal(id);
    const { data } = await this.goals.retireNodes({ ...input, id });
    return data;
  }

  async addEdge(id: string, input: AddGoalEdgeRequest) {
    await this.requireGoal(id);
    const { data } = await this.goals.addEdge({ ...input, id });
    return data;
  }

  async removeEdge(id: string, query: RemoveGoalEdgeQuery) {
    await this.requireGoal(id);
    const { data } = await this.goals.removeEdge({ ...query, id });
    return data;
  }

  // ==================== Events / decisions ====================

  async listEvents(id: string, query: GoalEventListQuery) {
    await this.requireGoal(id);
    const { data } = await this.goals.events({ ...query, id });
    return { ...data, hasMore: data.nextCursor !== null };
  }

  async listDecisions(id: string, query: GoalDecisionListQuery) {
    await this.requireGoal(id);
    const { decisions } = await this.goalService.graph(id);
    return query.status ? decisions.filter((item) => item.status === query.status) : decisions;
  }

  /** Answer one decision gate; the coordinator carries on from the answer. */
  async decide(id: string, decisionId: string, input: DecideGoalRequest) {
    await this.requireGoal(id);
    await this.goals.decide({ ...input, decisionId, id });
    const decision = (await this.goalService.graph(id)).decisions.find(
      (item) => item.id === decisionId,
    );
    if (!decision) throw this.createNotFoundError('Decision not found');
    return decision;
  }

  async answerClarifications(id: string, input: AnswerGoalClarificationsRequest) {
    await this.requireGoal(id);
    await this.goals.answerClarifications({ ...input, id });
    return this.goalService.graph(id);
  }

  // ==================== Measured acceptance ====================

  async getMetricState(id: string) {
    await this.requireGoal(id);
    const { data } = await this.goals.metricState({ id });
    return data;
  }

  async setMetricCriteria(id: string, input: SetGoalMetricsRequest) {
    await this.requireGoal(id);
    const { data } = await this.goals.setMetricCriteria({ ...input, id });
    return data;
  }

  async removeMetricCriteria(id: string, keys: string[]) {
    await this.requireGoal(id);
    const { data } = await this.goals.removeMetricCriteria({ id, keys });
    return data;
  }

  /**
   * Record a measurement and wake the coordinator only when it cleared the
   * gate. Called on the service rather than the procedure because the REST
   * answer reports whether the goal was woken, which the procedure drops.
   */
  async recordObservation(
    id: string,
    input: RecordGoalObservationRequest,
  ): Promise<GoalObservation> {
    await this.requireGoal(id);
    const { point, series, shouldAdvance } = await this.goalService.recordObservation(id, {
      ...input,
      observedAt: input.observedAt ? new Date(input.observedAt) : undefined,
    });
    if (!point) throw this.createCommonError('Failed to record the observation');
    if (shouldAdvance) await this.scheduleAdvance(id, 'observe');
    return {
      advanced: shouldAdvance,
      key: series.key,
      metricId: series.id,
      observedAt: new Date(point.observedAt).toISOString(),
      pointId: point.id,
      value: Number(point.value),
    };
  }

  // ==================== Close ====================

  async closeGoal(id: string, status: 'achieved' | 'canceled') {
    await this.requireGoal(id);
    const { data } = await this.goals.close({ id, status });
    return data;
  }
}
