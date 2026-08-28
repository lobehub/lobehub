import { TRPC_NAMESPACE_API_KEY_RULES } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { lambdaRouter } from '@/server/routers/lambda';
import { toolsRouter } from '@/server/routers/tools';

/**
 * The API key scope guard (`apiKeyScopeGuard`) denies any namespace missing
 * from `TRPC_NAMESPACE_API_KEY_RULES` — fail closed. That is the safe default
 * for restricted keys, but it must never happen *silently*: a newly mounted
 * router has to be consciously categorized (open / blocked / scoped).
 *
 * If this test fails, add the new namespace to
 * `packages/const/src/apiKeyScope.ts`.
 */
const namespacesOf = (router: { _def: { procedures: Record<string, unknown> } }) => {
  const namespaces = new Set<string>();
  for (const path of Object.keys(router._def.procedures)) {
    namespaces.add(path.split('.')[0]);
  }
  return namespaces;
};

describe('API key scope namespace coverage', () => {
  it('every lambda router namespace is categorized', () => {
    const uncategorized = [...namespacesOf(lambdaRouter)].filter(
      (ns) => !(ns in TRPC_NAMESPACE_API_KEY_RULES),
    );

    expect(uncategorized).toEqual([]);
  });

  it('every tools router namespace is categorized', () => {
    const uncategorized = [...namespacesOf(toolsRouter)].filter(
      (ns) => !(ns in TRPC_NAMESPACE_API_KEY_RULES),
    );

    expect(uncategorized).toEqual([]);
  });
});
