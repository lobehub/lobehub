// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('agentRouter procedures', () => {
  const procedures = (agentRouter as any)._def.procedures as Record<string, any>;

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
    ['checkOwnership', 'query', 13],
    ['createAgent', 'mutation', 14],
    ['createAgentVersion', 'mutation', 14],
    ['deprecateAgent', 'mutation', 14],
    ['forkAgent', 'mutation', 14],
    ['getAgentDetail', 'query', 13],
    ['getAgentForkSource', 'query', 13],
    ['getAgentForks', 'query', 13],
    ['getOnboardingFull', 'query', 13],
    ['getOwnAgents', 'query', 13],
    ['publishAgent', 'mutation', 14],
    ['publishOrCreate', 'mutation', 14],
    ['unpublishAgent', 'mutation', 14],
  ];
}
