// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { connectorRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('connectorRouter procedures', () => {
  const procedures = (connectorRouter as any)._def.procedures as Record<string, any>;

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
    ['bindAgent', 'mutation', 13],
    ['callTool', 'mutation', 13],
    ['copyToAgent', 'mutation', 13],
    ['create', 'mutation', 13],
    ['delete', 'mutation', 13],
    ['getForEdit', 'query', 13],
    ['getRedirectUri', 'query', 9],
    ['list', 'query', 11],
    ['listAgentBound', 'query', 11],
    ['listByAgent', 'query', 12],
    ['mountToAgent', 'mutation', 13],
    ['resetPermissions', 'mutation', 13],
    ['startOAuth', 'mutation', 13],
    ['syncBuiltinTool', 'mutation', 12],
    ['syncPluginTools', 'mutation', 12],
    ['syncTools', 'mutation', 13],
    ['syncToolsFromClient', 'mutation', 12],
    ['syncToolsFromClientById', 'mutation', 13],
    ['unbindAgent', 'mutation', 13],
    ['unmountFromAgent', 'mutation', 13],
    ['update', 'mutation', 13],
    ['updateToolPermission', 'mutation', 13],
  ];
}
