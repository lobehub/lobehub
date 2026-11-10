// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { verifyRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('verifyRouter procedures', () => {
  const procedures = (verifyRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['confirmPlan', 'mutation', 13],
    ['createCriteria', 'mutation', 13],
    ['createCriterion', 'mutation', 13],
    ['createRubric', 'mutation', 13],
    ['createRun', 'mutation', 13],
    ['deleteCriterion', 'mutation', 13],
    ['deleteEvidence', 'mutation', 13],
    ['deleteResult', 'mutation', 13],
    ['deleteRubric', 'mutation', 13],
    ['deleteRun', 'mutation', 13],
    ['disputeCheck', 'mutation', 13],
    ['executeVerify', 'mutation', 13],
    ['forkRubricCriteria', 'mutation', 13],
    ['generateCriteria', 'mutation', 13],
    ['generateDraftPlan', 'mutation', 13],
    ['generateGoalCriteria', 'mutation', 13],
    ['generateGoalPlan', 'mutation', 13],
    ['getCriteria', 'query', 12],
    ['getCriterionResults', 'query', 12],
    ['getReport', 'query', 12],
    ['getReportBundle', 'query', 7],
    ['getRubric', 'query', 12],
    ['getRubricCriteria', 'query', 12],
    ['getRun', 'query', 12],
    ['getRunAcceptanceRound', 'query', 7],
    ['getSkillBundle', 'query', 6],
    ['getVerifierThread', 'query', 12],
    ['getVerifierTracing', 'query', 12],
    ['getVerifyState', 'query', 12],
    ['ingestResult', 'mutation', 13],
    ['listCriteria', 'query', 12],
    ['listEvidence', 'query', 12],
    ['listReportSummaries', 'query', 12],
    ['listResults', 'query', 12],
    ['listResultsByRun', 'query', 12],
    ['listRubrics', 'query', 11],
    ['listRuns', 'query', 11],
    ['regenerateReport', 'mutation', 13],
    ['setRubricCriteria', 'mutation', 13],
    ['setRunVisibility', 'mutation', 13],
    ['skipPlan', 'mutation', 13],
    ['submitCheckEvidence', 'mutation', 13],
    ['submitDecision', 'mutation', 13],
    ['updateCriterion', 'mutation', 13],
    ['updateDraftItems', 'mutation', 13],
    ['updateRubric', 'mutation', 13],
    ['updateRun', 'mutation', 13],
    ['uploadEvidence', 'mutation', 13],
    ['upsertReport', 'mutation', 13],
  ];
}
