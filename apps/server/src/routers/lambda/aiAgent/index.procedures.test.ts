// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { aiAgentRouter } from '.';

/**
 * Pins the router's public procedure paths and query/mutation kinds.
 */
describe('aiAgentRouter procedures', () => {
  const procedures = (aiAgentRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s', (name, type) => {
    expect(procedures[name]._def.type).toBe(type);
  });
});

function expected(): Array<[name: string, type: 'mutation' | 'query']> {
  return [
    ['beginServerDefaultHeterogeneousOperation', 'mutation'],
    ['cancelServerDefaultHeterogeneousOperation', 'mutation'],
    ['createClientGroupAgentTaskThread', 'mutation'],
    ['createClientTaskThread', 'mutation'],
    ['describeServerDefaultHeterogeneousModel', 'mutation'],
    ['execAgent', 'mutation'],
    ['execAgents', 'mutation'],
    ['execGroupAgent', 'mutation'],
    ['execSubAgentTask', 'mutation'],
    ['finishServerDefaultHeterogeneousOperation', 'mutation'],
    ['getAgentInterventionReview', 'mutation'],
    ['getAgentInterventionReviewBySource', 'mutation'],
    ['getHeteroInterventionReview', 'mutation'],
    ['getOperationStatus', 'query'],
    ['getOperationStreamHistory', 'query'],
    ['getPendingInterventions', 'query'],
    ['getServerDefaultHeterogeneousCapability', 'query'],
    ['getSubAgentTaskStatus', 'query'],
    ['heteroFinish', 'mutation'],
    ['heteroIngest', 'mutation'],
    ['interruptTask', 'mutation'],
    ['issueGatewayUserToken', 'query'],
    ['listClientLlmWaits', 'query'],
    ['processHumanIntervention', 'mutation'],
    ['refreshGatewayToken', 'query'],
    ['refreshHeteroOperationToken', 'mutation'],
    ['releaseSubAgentLlmRelay', 'mutation'],
    ['resolveAgentIntervention', 'mutation'],
    ['resolveAgentInterventionBySource', 'mutation'],
    ['resolveHeteroIntervention', 'mutation'],
    ['resumeClientLlmWait', 'mutation'],
    ['scheduleAgentRun', 'mutation'],
    ['setQueuedMessages', 'mutation'],
    ['startExecution', 'mutation'],
    ['stopPendingApproval', 'mutation'],
    ['submitHeteroIntervention', 'mutation'],
    ['updateClientTaskThreadStatus', 'mutation'],
    ['waitInterventionResponse', 'query'],
  ];
}
