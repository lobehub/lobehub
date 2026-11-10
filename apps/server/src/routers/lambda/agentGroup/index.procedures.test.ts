// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentGroupRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('agentGroupRouter procedures', () => {
  const procedures = (agentGroupRouter as any)._def.procedures as Record<string, any>;

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
    ['acquireGroupLock', 'mutation', 13],
    ['addAgentsToGroup', 'mutation', 13],
    ['batchCreateAgentsInGroup', 'mutation', 13],
    ['checkAgentsBeforeRemoval', 'query', 12],
    ['createGroup', 'mutation', 13],
    ['createGroupWithMembers', 'mutation', 13],
    ['deleteGroup', 'mutation', 13],
    ['duplicateGroup', 'mutation', 13],
    ['getGroup', 'query', 12],
    ['getGroupAgents', 'query', 12],
    ['getGroupByForkedFromIdentifier', 'query', 12],
    ['getGroupDetail', 'query', 12],
    ['getGroupLock', 'query', 13],
    ['getGroups', 'query', 11],
    ['getTransferJobStatus', 'query', 12],
    ['listReferencedMembers', 'query', 12],
    ['publishGroupToWorkspace', 'mutation', 13],
    ['releaseGroupLock', 'mutation', 13],
    ['removeAgentsFromGroup', 'mutation', 13],
    ['setGroupVisibility', 'mutation', 13],
    ['transferGroup', 'mutation', 13],
    ['updateAgentInGroup', 'mutation', 13],
    ['updateGroup', 'mutation', 13],
  ];
}
