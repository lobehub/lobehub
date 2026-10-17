// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { acceptanceRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('acceptanceRouter procedures', () => {
  const procedures = (acceptanceRouter as any)._def.procedures as Record<string, any>;

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
    ['accept', 'mutation', 13],
    ['addGroupFeedback', 'mutation', 13],
    ['adjudicateProposal', 'mutation', 13],
    ['attachRun', 'mutation', 13],
    ['completeFlow', 'mutation', 13],
    ['deleteFlow', 'mutation', 13],
    ['ensure', 'mutation', 13],
    ['getBundle', 'query', 7],
    ['getBySubject', 'query', 12],
    ['linkPullRequest', 'mutation', 13],
    ['list', 'query', 12],
    ['listPage', 'query', 12],
    ['listStatusesBySubjects', 'query', 12],
    ['markRepairing', 'mutation', 13],
    ['merge', 'mutation', 13],
    ['predictReviews', 'mutation', 13],
    ['publishFlow', 'mutation', 13],
    ['purgePreview', 'query', 12],
    ['recordFlowStep', 'mutation', 13],
    ['regroupChecks', 'mutation', 13],
    ['reject', 'mutation', 13],
    ['remove', 'mutation', 13],
    ['removeBatch', 'mutation', 13],
    ['rename', 'mutation', 13],
    ['reviewChecks', 'mutation', 13],
    ['reviewFlowStep', 'mutation', 13],
    ['saveChecklist', 'mutation', 13],
    ['saveGoal', 'mutation', 13],
    ['setPreviewUrl', 'mutation', 13],
    ['setProject', 'mutation', 13],
    ['setProjectBatch', 'mutation', 13],
    ['setVisibility', 'mutation', 13],
    ['startFlow', 'mutation', 13],
    ['unlinkPullRequest', 'mutation', 13],
    ['updateStatus', 'mutation', 13],
    ['updateStatusBatch', 'mutation', 13],
  ];
}
