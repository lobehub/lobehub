// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { aiAgentRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('aiAgentRouter procedures', () => {
  const procedures = (aiAgentRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<[name: string, type: 'mutation' | 'query', middlewares: number]> {
  return [
    ['beginServerDefaultHeterogeneousOperation', 'mutation', 11],
    ['cancelServerDefaultHeterogeneousOperation', 'mutation', 11],
    ['createClientGroupAgentTaskThread', 'mutation', 13],
    ['createClientTaskThread', 'mutation', 13],
    ['describeServerDefaultHeterogeneousModel', 'mutation', 11],
    ['execAgent', 'mutation', 13],
    ['execAgents', 'mutation', 13],
    ['execGroupAgent', 'mutation', 13],
    ['execSubAgentTask', 'mutation', 13],
    ['finishServerDefaultHeterogeneousOperation', 'mutation', 11],
    ['getAgentInterventionReview', 'mutation', 11],
    ['getAgentInterventionReviewBySource', 'mutation', 11],
    ['getHeteroInterventionReview', 'mutation', 11],
    ['getOperationStatus', 'query', 12],
    ['getPendingInterventions', 'query', 12],
    ['getServerDefaultHeterogeneousCapability', 'query', 10],
    ['getSubAgentTaskStatus', 'query', 12],
    ['heteroFinish', 'mutation', 8],
    ['heteroIngest', 'mutation', 8],
    ['interruptTask', 'mutation', 13],
    ['issueGatewayUserToken', 'query', 11],
    ['listClientLlmWaits', 'query', 12],
    ['processHumanIntervention', 'mutation', 13],
    ['refreshGatewayToken', 'query', 12],
    ['refreshHeteroOperationToken', 'mutation', 8],
    ['releaseSubAgentLlmRelay', 'mutation', 13],
    ['resolveAgentIntervention', 'mutation', 13],
    ['resolveAgentInterventionBySource', 'mutation', 13],
    ['resolveHeteroIntervention', 'mutation', 13],
    ['resumeClientLlmWait', 'mutation', 13],
    ['scheduleAgentRun', 'mutation', 13],
    ['setQueuedMessages', 'mutation', 13],
    ['startExecution', 'mutation', 13],
    ['stopPendingApproval', 'mutation', 13],
    ['submitHeteroIntervention', 'mutation', 13],
    ['updateClientTaskThreadStatus', 'mutation', 13],
    ['waitInterventionResponse', 'query', 8],
  ];
}
