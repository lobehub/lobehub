// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { goalRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('goalRouter procedures', () => {
  const procedures = (goalRouter as any)._def.procedures as Record<string, any>;

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
    ['addEdge', 'mutation', 13],
    ['addNode', 'mutation', 13],
    ['advance', 'mutation', 13],
    ['answerClarifications', 'mutation', 13],
    ['bindOperationTopic', 'mutation', 8],
    ['bindTopic', 'mutation', 13],
    ['close', 'mutation', 13],
    ['create', 'mutation', 13],
    ['createConversationGoal', 'mutation', 8],
    ['decide', 'mutation', 13],
    ['delete', 'mutation', 13],
    ['events', 'query', 12],
    ['eventsOperation', 'query', 9],
    ['graph', 'query', 12],
    ['graphOperation', 'query', 9],
    ['list', 'query', 12],
    ['pause', 'mutation', 13],
    ['pendingClarifications', 'query', 11],
    ['pendingForIsland', 'query', 11],
    ['planContext', 'query', 12],
    ['planContextOperation', 'query', 9],
    ['recordObservation', 'mutation', 13],
    ['removeEdge', 'mutation', 13],
    ['restart', 'mutation', 13],
    ['resume', 'mutation', 13],
    ['retireNodes', 'mutation', 13],
    ['setAcceptanceCriteria', 'mutation', 13],
    ['setAgent', 'mutation', 13],
    ['setBudget', 'mutation', 13],
    ['setMetricCriteria', 'mutation', 13],
    ['setTaskAgent', 'mutation', 13],
    ['start', 'mutation', 13],
    ['startOperation', 'mutation', 8],
    ['submitOperationPlan', 'mutation', 8],
    ['submitOperationReport', 'mutation', 8],
    ['submitPlan', 'mutation', 13],
    ['submitReport', 'mutation', 13],
    ['supervision', 'query', 12],
    ['tick', 'mutation', 13],
    ['updateRequirement', 'mutation', 13],
    ['wake', 'mutation', 13],
  ];
}
