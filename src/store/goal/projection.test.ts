import { describe, expect, it } from 'vitest';

import {
  globalGoalListScopeId,
  goalListKey,
  goalListScopeId,
  goalListScopeParams,
} from './projection';

describe('goal list scopes', () => {
  it.each([{ agentId: 'agt-1' }, { projectId: 'proj-1' }, { globalScope: 'user-1:workspace-1' }])(
    'round-trips the %o scope through its scope id',
    (scope) => {
      const scopeId = goalListScopeId(scope);

      expect(goalListScopeParams(scopeId, 'review')).toEqual({ ...scope, filter: 'review' });
    },
  );

  it('keys the cross-agent list per cache scope, apart from any agent or project', () => {
    expect(goalListScopeId({ globalScope: 'user-1:workspace-1' })).toBe(
      globalGoalListScopeId('user-1:workspace-1'),
    );
    expect(goalListKey({ filter: 'all', globalScope: 'user-1:workspace-1' })).toBe(
      'global:user-1:workspace-1',
    );
    expect(goalListKey({ filter: 'running', globalScope: 'user-1:workspace-2' })).toBe(
      'global:user-1:workspace-2:goals-page:running',
    );
  });
});
