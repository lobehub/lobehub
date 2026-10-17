// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { userMemoriesRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('userMemoriesRouter procedures', () => {
  const procedures = (userMemoriesRouter as any)._def.procedures as Record<string, any>;

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
    ['getMemoryDetail', 'query', 11],
    ['queryActivities', 'query', 12],
    ['queryExperiences', 'query', 12],
    ['queryIdentities', 'query', 12],
    ['queryIdentitiesForInjection', 'query', 11],
    ['queryIdentityRoles', 'query', 11],
    ['queryMemories', 'query', 12],
    ['queryTags', 'query', 11],
    ['queryTaxonomyOptions', 'query', 11],
    ['reEmbedMemories', 'mutation', 12],
    ['retrieveMemoryForTopic', 'query', 12],
    ['searchMemory', 'query', 12],
    ['toolAddActivityMemory', 'mutation', 12],
    ['toolAddContextMemory', 'mutation', 12],
    ['toolAddExperienceMemory', 'mutation', 12],
    ['toolAddIdentityMemory', 'mutation', 12],
    ['toolAddPreferenceMemory', 'mutation', 12],
    ['toolRemoveIdentityMemory', 'mutation', 12],
    ['toolSearchMemory', 'query', 12],
    ['toolUpdateIdentityMemory', 'mutation', 12],
  ];
}
