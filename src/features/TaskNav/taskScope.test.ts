import { describe, expect, it } from 'vitest';

import { resolveTaskScope, taskScopeUrl } from './taskScope';

describe('resolveTaskScope', () => {
  it.each([
    ['/tasks', '', null, { type: 'all' }],
    ['/task/T-1/slug', '', null, { type: 'all' }],
    ['/tasks', '?project=prj_1', null, { projectId: 'prj_1', type: 'project' }],
    ['/team/tasks', '?project=prj_1&x=1', 'team', { projectId: 'prj_1', type: 'project' }],
    ['/goals', '', null, { type: 'goals' }],
    ['/team/goal/g-1', '', 'team', { type: 'goals' }],
    // The project param only scopes the task list itself.
    ['/goals', '?project=prj_1', null, { type: 'goals' }],
  ])('maps %s%s', (pathname, search, slug, expected) => {
    expect(resolveTaskScope(pathname, search, slug)).toEqual(expected);
  });
});

describe('taskScopeUrl', () => {
  it('builds the scoped task list url', () => {
    expect(taskScopeUrl()).toBe('/tasks');
    expect(taskScopeUrl('prj 1')).toBe('/tasks?project=prj%201');
  });
});
