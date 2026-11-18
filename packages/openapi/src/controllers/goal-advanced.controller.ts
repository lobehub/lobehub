import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { GoalAdvancedRestService } from '../services/goal-advanced.service';
import type { GoalIdParam } from '../types/goal.type';
import type {
  AddGoalEdgeRequest,
  AddGoalNodeRequest,
  AnswerGoalClarificationsRequest,
  CloseGoalRequest,
  DecideGoalRequest,
  GoalDecisionListQuery,
  GoalDecisionParam,
  GoalEventListQuery,
  GoalGraphQuery,
  RecordGoalObservationRequest,
  RemoveGoalEdgeQuery,
  RemoveGoalMetricsQuery,
  RetireGoalNodesRequest,
  SetGoalMetricsRequest,
  UpdateGoalConfigRequest,
} from '../types/goal-advanced.type';

/**
 * Goal control controller — configuration, graph edits, events, decisions,
 * clarifications, measured acceptance and close. HTTP concerns only.
 */
export class GoalAdvancedController extends BaseController {
  private async service(c: Context): Promise<GoalAdvancedRestService> {
    return new GoalAdvancedRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole'),
    );
  }

  /** Run `handler` with the path's goal id and answer with its result. */
  private async respond<T>(
    c: Context,
    handler: (service: GoalAdvancedRestService, id: string) => Promise<T>,
    message: string,
    status?: 201,
  ): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      return this.success(c, await handler(await this.service(c), id), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  updateConfig = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.updateConfig(id, await this.getBody<UpdateGoalConfigRequest>(c)),
      'Goal configuration updated',
    );

  getGraph = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.getGraph(id, this.getQuery<GoalGraphQuery>(c).capabilities),
      'Goal graph retrieved successfully',
    );

  addNode = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.addNode(id, await this.getBody<AddGoalNodeRequest>(c)),
      'Node added',
      201,
    );

  retireNodes = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.retireNodes(id, await this.getBody<RetireGoalNodesRequest>(c)),
      'Nodes retired',
    );

  addEdge = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.addEdge(id, await this.getBody<AddGoalEdgeRequest>(c)),
      'Edge added',
      201,
    );

  removeEdge = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.removeEdge(id, this.getQuery<RemoveGoalEdgeQuery>(c)),
      'Edges removed',
    );

  listEvents = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.listEvents(id, this.getQuery<GoalEventListQuery>(c)),
      'Goal events retrieved successfully',
    );

  listDecisions = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.listDecisions(id, this.getQuery<GoalDecisionListQuery>(c)),
      'Goal decisions retrieved successfully',
    );

  decide = (c: Context) =>
    this.respond(
      c,
      async (s, id) =>
        s.decide(
          id,
          this.getParams<GoalDecisionParam>(c).decisionId,
          await this.getBody<DecideGoalRequest>(c),
        ),
      'Decision resolved',
    );

  answerClarifications = (c: Context) =>
    this.respond(
      c,
      async (s, id) =>
        s.answerClarifications(id, await this.getBody<AnswerGoalClarificationsRequest>(c)),
      'Clarifications answered',
    );

  getMetricState = (c: Context) =>
    this.respond(c, (s, id) => s.getMetricState(id), 'Goal metrics retrieved successfully');

  setMetricCriteria = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.setMetricCriteria(id, await this.getBody<SetGoalMetricsRequest>(c)),
      'Metric criteria updated',
    );

  removeMetricCriteria = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.removeMetricCriteria(id, this.getQuery<RemoveGoalMetricsQuery>(c).keys),
      'Metric criteria removed',
    );

  recordObservation = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.recordObservation(id, await this.getBody<RecordGoalObservationRequest>(c)),
      'Observation recorded',
      201,
    );

  closeGoal = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.closeGoal(id, (await this.getBody<CloseGoalRequest>(c)).status),
      'Goal closed',
    );
}
