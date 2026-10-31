import { describe, expect, it } from 'vitest';

import { resolveRailTab } from './railTab';

describe('resolveRailTab', () => {
  it.each([
    ['/', null, 'messages'],
    ['/agent/agent-1', null, 'messages'],
    ['/lobe-team/group/group-1/tpc_1', 'lobe-team', 'messages'],
    ['/agents', null, 'contacts'],
    ['/agent/agent-1/profile', null, 'contacts'],
    ['/lobe-team/group/group-1/profile', 'lobe-team', 'contacts'],
    // Goals are merged into the Tasks tab.
    ['/tasks', null, 'tasks'],
    ['/goals', null, 'tasks'],
    ['/goal/goal-1', null, 'tasks'],
    ['/lobe-team/task/task-1/fix', 'lobe-team', 'tasks'],
    ['/projects', null, 'projects'],
    ['/project/project-1/tasks', null, 'projects'],
    ['/resource/library/kb-1', null, 'resource'],
    ['/page/page-1/permission', null, 'resource'],
    ['/community/agent/slug', null, 'discover'],
    ['/settings/provider/openai', null, 'settings'],
    ['/memory', null, 'more'],
    ['/image', null, 'more'],
  ])('maps %s to %s', (pathname, activeWorkspaceSlug, expected) => {
    expect(resolveRailTab(pathname, activeWorkspaceSlug)).toBe(expected);
  });
});
