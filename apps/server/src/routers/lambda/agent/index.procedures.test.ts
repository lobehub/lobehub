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
    ['acquireAgentLock', 'mutation', 13],
    ['checkByMarketIdentifier', 'query', 12],
    ['countAgents', 'query', 12],
    ['createAgent', 'mutation', 13],
    ['createAgentFiles', 'mutation', 13],
    ['createAgentKnowledgeBase', 'mutation', 13],
    ['createAgentOnly', 'mutation', 13],
    ['deleteAgentFile', 'mutation', 13],
    ['deleteAgentKnowledgeBase', 'mutation', 13],
    ['duplicateAgent', 'mutation', 13],
    ['getAgentByForkedFromIdentifier', 'query', 12],
    ['getAgentByMarketIdentifier', 'query', 12],
    ['getAgentConfig', 'query', 12],
    ['getAgentConfigById', 'query', 12],
    ['getAgentLock', 'query', 13],
    ['getBuiltinAgent', 'query', 12],
    ['getGroupMembershipImpact', 'query', 12],
    ['getKnowledgeBasesAndFiles', 'query', 12],
    ['getTransferJobStatus', 'query', 12],
    ['prioritizeTransferTopic', 'mutation', 12],
    ['publishAgentToWorkspace', 'mutation', 13],
    ['queryAgents', 'query', 12],
    ['rankAgents', 'query', 12],
    ['releaseAgentLock', 'mutation', 13],
    ['removeAgent', 'mutation', 13],
    ['resolveAgentIdBySlug', 'query', 12],
    ['resolveAgentRoute', 'query', 12],
    ['setAgentVisibility', 'mutation', 13],
    ['toggleFile', 'mutation', 13],
    ['toggleKnowledgeBase', 'mutation', 13],
    ['transferAgent', 'mutation', 13],
    ['transferAgents', 'mutation', 13],
    ['updateAgentConfig', 'mutation', 13],
    ['updateAgentPinned', 'mutation', 13],
    ['updateAgentSlug', 'mutation', 13],
  ];
}
