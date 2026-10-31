import { describe, expect, it } from 'vitest';

import { isRailContactsRoute, resolveRailNavPanelKey } from './railRouteKey';

describe('resolveRailNavPanelKey', () => {
  it.each([
    ['/', null, 'home'],
    ['/lobe-team', 'lobe-team', 'home'],
    // Agent / group routes keep their own workbench sidebar.
    ['/agent/agent-1', null, 'agent'],
    ['/agent/agent-1/tpc_1', null, 'agent'],
    ['/lobe-team/agent/agent-1', 'lobe-team', 'agent'],
    ['/agent/agent-1/profile', null, 'agent'],
    ['/agent/agent-1/tasks', null, 'agent'],
    ['/agent/agent-1/goal/goal-1', null, 'agent'],
    ['/agent/agent-1/docs/doc-1', null, 'agent-docs'],
    ['/group/group-1', null, 'group'],
    ['/group/group-1/tpc_1', null, 'group'],
    // The all-agents page shows the Contacts list.
    ['/agents', null, 'contacts'],
    ['/lobe-team/agents', 'lobe-team', 'contacts'],
    // Tasks and goals share the task scope list; the project index is full-page.
    ['/tasks', null, 'tasks'],
    ['/goals', null, 'tasks'],
    ['/lobe-team/task/task-1', 'lobe-team', 'tasks'],
    ['/goal/goal-1', null, 'tasks'],
    ['/projects', null, 'none'],
    // Everything else keeps its route-owned sidebar.
    ['/project/project-1', null, 'project'],
    ['/resource', null, 'resource'],
    ['/resource/library/kb-1', null, 'resourceLibrary'],
    ['/community', null, 'discover'],
    ['/settings/profile', null, 'settings'],
  ])('maps %s to %s', (pathname, activeWorkspaceSlug, expected) => {
    expect(resolveRailNavPanelKey(pathname, activeWorkspaceSlug)).toBe(expected);
  });
});

describe('isRailContactsRoute', () => {
  it.each([
    ['/agents', null, true],
    ['/agent/agent-1/profile', null, true],
    ['/lobe-team/agent/agent-1/channel/discord', 'lobe-team', true],
    ['/agent/agent-1/self-evolving/domain-1', null, true],
    ['/group/group-1/profile', null, true],
    ['/agent/agent-1', null, false],
    ['/agent/agent-1/tpc_1', null, false],
    ['/agent/agent-1/tasks', null, false],
    ['/group/group-1', null, false],
  ])('%s → %s', (pathname, activeWorkspaceSlug, expected) => {
    expect(isRailContactsRoute(pathname, activeWorkspaceSlug)).toBe(expected);
  });
});
