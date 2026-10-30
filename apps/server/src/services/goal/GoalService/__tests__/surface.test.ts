// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

/**
 * Every collaborator the service holds. Tests reach some of them through casts
 * (`goalModel`, `graphModel`), so they stay instance properties.
 */
const FIELDS = [
  'acceptanceService',
  'agentModel',
  'briefs',
  'coordinatorGraph',
  'db',
  'goalModel',
  'graphModel',
  'releaseReview',
  'taskModel',
  'taskService',
  'taskTopicModel',
  'userId',
  'workModel',
  'workspaceId',
];

/**
 * Every method, public or private, as an own instance property. Tests and
 * collaborators call or spy on private ones by name (`requireGraph`,
 * `consumeCompletedTask`), so each must stay reachable on the instance and keep
 * routing internal calls through it.
 */
const METHODS = [
  'addEdge',
  'addNode',
  'answerClarifications',
  'answerReleaseGate',
  'attachTaskDeliverables',
  'bindTopic',
  'buildTaskAcceptanceRequirement',
  'buildTaskInstruction',
  'close',
  'collectAcceptances',
  'collectAssignees',
  'collectDeliveredAt',
  'collectQuotaWaits',
  'collectRolloutGate',
  'collectRunHeartbeats',
  'consumeCompletedTask',
  'create',
  'createFromConversation',
  'createResponsibleTask',
  'decide',
  'delete',
  'dispatchGoalReport',
  'dispatchWork',
  'ensureTaskWorkVersion',
  'evaluateBudget',
  'evaluateMetricCriteria',
  'followGoalAgent',
  'gateOrTakeOver',
  'goalOwnerTaskScope',
  'graph',
  'graphAs',
  'handPlanningToMainAgent',
  'holdForMachineFailure',
  'holdForOfflineDevice',
  'isBatchMember',
  'isParkedOnMeasuredGate',
  'listEvents',
  'markRunLostToOfflineDevice',
  'metricState',
  'openFailureDecision',
  'openFailureDecisionLocked',
  'openPatternBreakGate',
  'pause',
  'pendingClarifications',
  'pendingForIsland',
  'planDecomposition',
  'planMachineRecoveryFor',
  'readRunDevicePresence',
  'reassignUnfinishedTasks',
  'recordObservation',
  'recoverAbandonedTask',
  'recoverAfterVerification',
  'recoverLostRun',
  'removeMetricCriteria',
  'reopenForChanges',
  'reopenIfMeasurementCleared',
  'requestSignOff',
  'requireGraph',
  'resolveSpend',
  'resolveTaskAssignee',
  'resolveTopicRun',
  'restart',
  'restartRolloutLoop',
  'resume',
  'resumeAbandonedTaskRecovery',
  'retireNodes',
  'setAcceptanceCriteria',
  'setAgent',
  'setBudget',
  'setMetricCriteria',
  'setModel',
  'setPauseReason',
  'setTaskAgent',
  'setTaskModel',
  'settleTerminalAcceptance',
  'status',
  'stopFencedTasks',
  'tick',
  'tickOnce',
  'transitionStatus',
  'updateRequirement',
  'waitForDevice',
  'waitForQuotaReset',
];

describe('GoalService instance surface', () => {
  const service = new GoalService(serverDB, 'goal-surface-user', 'goal-surface-workspace');
  const members = service as unknown as Record<string, unknown>;

  it('holds exactly the expected fields and methods as own properties', () => {
    expect(Object.keys(service).sort()).toEqual([...FIELDS, ...METHODS].sort());
  });

  it.each(METHODS)('%s is a bound instance function', (name) => {
    expect(typeof members[name]).toBe('function');
    expect(Object.prototype.hasOwnProperty.call(service, name)).toBe(true);
  });

  it('keeps the constructor arguments on the instance', () => {
    expect(members.db).toBe(serverDB);
    expect(members.userId).toBe('goal-surface-user');
    expect(members.workspaceId).toBe('goal-surface-workspace');
  });

  it('routes internal calls through the instance, so a spy on a private method sees them', async () => {
    const requireGraph = vi
      .spyOn(members as { requireGraph: (id: string) => Promise<unknown> }, 'requireGraph')
      .mockRejectedValue(new Error('spied'));
    await expect(service.tick('goal-that-does-not-exist')).rejects.toThrow('spied');
    expect(requireGraph).toHaveBeenCalledWith('goal-that-does-not-exist');
    requireGraph.mockRestore();
  });
});
