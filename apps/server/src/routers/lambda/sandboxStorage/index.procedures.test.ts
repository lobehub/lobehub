// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { sandboxStorageRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 *
 * The environment and GitHub procedures are the `environment` router's own,
 * answered here under their released paths for older clients — which is why
 * they carry its shorter chain (no drive claim, no entitlement) rather than
 * this router's.
 */
describe('sandboxStorageRouter procedures', () => {
  const procedures = (sandboxStorageRouter as any)._def.procedures as Record<string, any>;

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
    ['copyInstance', 'mutation', 15],
    ['createDirectory', 'mutation', 15],
    ['createEnvironment', 'mutation', 15],
    ['createInstance', 'mutation', 15],
    ['createInstanceForEnvironment', 'mutation', 15],
    ['getDriveUsage', 'query', 12],
    ['getEntitlement', 'query', 11],
    ['getInstance', 'query', 15],
    ['getStorage', 'query', 13],
    ['instanceBuildStatus', 'query', 15],
    ['listEnvironments', 'query', 12],
    ['listFiles', 'query', 15],
    ['listGithubBranches', 'query', 12],
    ['listGithubRepositories', 'query', 11],
    ['listInstanceSessions', 'query', 15],
    ['listInstances', 'query', 15],
    ['readFile', 'query', 15],
    ['refreshStorageUsage', 'mutation', 13],
    ['removeEnvironment', 'mutation', 15],
    ['removeFile', 'mutation', 15],
    ['removeInstance', 'mutation', 15],
    ['renameFile', 'mutation', 15],
    ['renameInstance', 'mutation', 15],
    ['resolveSessionPlacement', 'query', 12],
    ['setEnvironmentVisibility', 'mutation', 12],
    ['startInstanceBuild', 'mutation', 15],
    ['stopInstance', 'mutation', 15],
    ['updateEnvironment', 'mutation', 12],
    ['writeFile', 'mutation', 15],
  ];
}
