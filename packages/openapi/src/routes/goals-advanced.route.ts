import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GoalAdvancedController } from '../controllers/goal-advanced.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  GoalGraphDecisionSchema,
  GoalGraphEdgeSchema,
  GoalGraphNodeSchema,
  GoalGraphSchema,
  GoalIdParamSchema,
  GoalSchema,
} from '../types/goal.type';
import {
  AddGoalEdgeRequestSchema,
  AddGoalNodeRequestSchema,
  AnswerGoalClarificationsRequestSchema,
  CloseGoalRequestSchema,
  DecideGoalRequestSchema,
  GoalConfigUpdateResultSchema,
  GoalDecisionListQuerySchema,
  GoalDecisionListSchema,
  GoalDecisionParamSchema,
  GoalEventListQuerySchema,
  GoalEventListSchema,
  GoalGraphQuerySchema,
  GoalMetricStateSchema,
  GoalObservationSchema,
  GoalRemovedEdgesSchema,
  GoalRetiredNodesSchema,
  RecordGoalObservationRequestSchema,
  RemoveGoalEdgeQuerySchema,
  RemoveGoalMetricsQuerySchema,
  RetireGoalNodesRequestSchema,
  SetGoalMetricsRequestSchema,
  UpdateGoalConfigRequestSchema,
} from '../types/goal-advanced.type';

/**
 * Goal control routes, mounted under `/api/v1/goals`: configuration, hand edits
 * to the graph, the event feed, decision gates and clarifications, measured
 * acceptance and close. Same `agent:read` / `agent:update` gate as the goal
 * routes; destructive edits are further limited to the goal's creator or a
 * workspace owner.
 */
const GoalAdvancedRoutes = new Hono();

const goalRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  'You do not have permission to view goals',
);
const goalWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to manage goals',
);

const controller = () => new GoalAdvancedController();
const tags = ['goals'];

// ==================== Configuration ====================

GoalAdvancedRoutes.patch(
  '/:id/config',
  routeDoc({
    data: GoalConfigUpdateResultSchema,
    description:
      'Patches the requirement, budget, goal agent, task agent and both models in one transaction: a part the goal refuses leaves the others unapplied. Changing an agent or a model is limited to the goal creator or a workspace owner.',
    // 400: a budget the goal cannot take; 412: an archived goal.
    errors: [404, 412],
    summary: 'Update a goal configuration',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', UpdateGoalConfigRequestSchema),
  (c) => controller().updateConfig(c),
);

// ==================== Graph ====================

GoalAdvancedRoutes.get(
  '/:id/graph',
  routeDoc({
    data: GoalGraphSchema,
    description:
      'The goal with its nodes, edges, decisions, recent events and roll-ups. Node kinds missing from `capabilities` are sent as the kind an older client already draws.',
    errors: [404],
    summary: 'Get a goal graph',
    tags,
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  zValidator('query', GoalGraphQuerySchema),
  (c) => controller().getGraph(c),
);

GoalAdvancedRoutes.post(
  '/:id/nodes',
  routeDoc({
    data: GoalGraphNodeSchema,
    errors: [404, 412],
    operationId: 'goals.addNode',
    status: 201,
    summary: 'Add a node to a goal graph',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', AddGoalNodeRequestSchema),
  (c) => controller().addNode(c),
);

GoalAdvancedRoutes.post(
  '/:id/nodes/retire',
  routeDoc({
    data: GoalRetiredNodesSchema,
    description:
      'Retires task nodes nobody wants run and cancels their Tasks. Limited to the goal creator or a workspace owner.',
    errors: [404, 412],
    operationId: 'goals.retireNodes',
    summary: 'Retire task nodes',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', RetireGoalNodesRequestSchema),
  (c) => controller().retireNodes(c),
);

GoalAdvancedRoutes.post(
  '/:id/edges',
  routeDoc({
    data: GoalGraphEdgeSchema,
    errors: [404, 412],
    operationId: 'goals.addEdge',
    status: 201,
    summary: 'Add an edge to a goal graph',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', AddGoalEdgeRequestSchema),
  (c) => controller().addEdge(c),
);

GoalAdvancedRoutes.delete(
  '/:id/edges',
  routeDoc({
    data: GoalRemovedEdgesSchema,
    description:
      'Removes the edges from source to target while the goal is a draft. Limited to the goal creator or a workspace owner.',
    // 412: the goal has left draft.
    errors: [404, 412],
    operationId: 'goals.removeEdge',
    summary: 'Remove edges from a draft goal graph',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('query', RemoveGoalEdgeQuerySchema),
  (c) => controller().removeEdge(c),
);

// ==================== Events / decisions ====================

GoalAdvancedRoutes.get(
  '/:id/events',
  routeDoc({
    data: GoalEventListSchema,
    description: "The goal's audit trail, newest first, paged by cursor.",
    errors: [404],
    summary: 'List goal events',
    tags,
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  zValidator('query', GoalEventListQuerySchema),
  (c) => controller().listEvents(c),
);

GoalAdvancedRoutes.get(
  '/:id/decisions',
  routeDoc({
    data: GoalDecisionListSchema,
    description: 'Decision gates and clarification questions; `status=pending` lists open ones.',
    errors: [404],
    summary: 'List goal decisions',
    tags,
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  zValidator('query', GoalDecisionListQuerySchema),
  (c) => controller().listDecisions(c),
);

GoalAdvancedRoutes.post(
  '/:id/decisions/:decisionId',
  routeDoc({
    data: GoalGraphDecisionSchema,
    description: 'Answers one pending decision gate; the coordinator carries on from the answer.',
    // 409: the goal has ended.
    errors: [404, 409, 412],
    operationId: 'goals.decide',
    summary: 'Answer a goal decision',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalDecisionParamSchema),
  zValidator('json', DecideGoalRequestSchema),
  (c) => controller().decide(c),
);

GoalAdvancedRoutes.post(
  '/:id/clarifications',
  routeDoc({
    data: GoalGraphSchema,
    description:
      "Answers the goal's clarification round at once, so the re-plan starts with every answer.",
    errors: [404, 409, 412],
    operationId: 'goals.answerClarifications',
    summary: 'Answer goal clarifications',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', AnswerGoalClarificationsRequestSchema),
  (c) => controller().answerClarifications(c),
);

// ==================== Measured acceptance ====================

GoalAdvancedRoutes.get(
  '/:id/metrics',
  routeDoc({
    data: GoalMetricStateSchema,
    description: 'Each declared numeric acceptance clause with the value the gate reads now.',
    errors: [404],
    operationId: 'goals.getMetricState',
    summary: 'Get goal metric state',
    tags,
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  (c) => controller().getMetricState(c),
);

GoalAdvancedRoutes.put(
  '/:id/metrics',
  routeDoc({
    data: GoalGraphSchema,
    description:
      'Declares the numeric clauses gating acceptance. `mode: merge` upserts by key; `replace` swaps the list. Limited to the goal creator or a workspace owner.',
    errors: [404, 412],
    operationId: 'goals.setMetricCriteria',
    summary: 'Set goal metric criteria',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', SetGoalMetricsRequestSchema),
  (c) => controller().setMetricCriteria(c),
);

GoalAdvancedRoutes.delete(
  '/:id/metrics',
  routeDoc({
    data: GoalGraphSchema,
    errors: [404, 412],
    operationId: 'goals.removeMetricCriteria',
    summary: 'Remove goal metric criteria',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('query', RemoveGoalMetricsQuerySchema),
  (c) => controller().removeMetricCriteria(c),
);

GoalAdvancedRoutes.post(
  '/:id/metrics/observations',
  routeDoc({
    data: GoalObservationSchema,
    description:
      'Records a measurement against the goal. When it is the last unmet clause, the goal wakes and closes on it.',
    errors: [404],
    operationId: 'goals.recordObservation',
    status: 201,
    summary: 'Record a goal measurement',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', RecordGoalObservationRequestSchema),
  (c) => controller().recordObservation(c),
);

// ==================== Close ====================

GoalAdvancedRoutes.post(
  '/:id/close',
  routeDoc({
    data: GoalSchema,
    description:
      'Ends the goal as achieved or canceled and interrupts its live runs; reopen it with resume. Limited to the goal creator or a workspace owner.',
    // 412: an archived goal, or a run still starting — retry shortly.
    errors: [404, 412],
    operationId: 'goals.close',
    summary: 'Close a goal',
    tags,
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', CloseGoalRequestSchema),
  (c) => controller().closeGoal(c),
);

export default GoalAdvancedRoutes;
