import { describe, expect, it } from 'vitest';

import { resolveRailNavPanelKey } from './railRouteKey';

describe('resolveRailNavPanelKey', () => {
  it.each([
    ['/', null, 'home'],
    ['/lobe-team', 'lobe-team', 'home'],
    // Chats live in the conversation list (Messages tab).
    ['/agent/agent-1', null, 'home'],
    ['/agent/agent-1/tpc_1', null, 'home'],
    ['/lobe-team/agent/agent-1', 'lobe-team', 'home'],
    ['/group/group-1', null, 'home'],
    ['/group/group-1/tpc_1', null, 'home'],
    // Agent / group profile and config pages belong to Contacts.
    ['/agents', null, 'contacts'],
    ['/lobe-team/agents', 'lobe-team', 'contacts'],
    ['/agent/agent-1/profile', null, 'contacts'],
    ['/lobe-team/agent/agent-1/channel/discord', 'lobe-team', 'contacts'],
    ['/agent/agent-1/self-evolving/domain-1', null, 'contacts'],
    ['/group/group-1/profile', null, 'contacts'],
    // Agent-scoped tasks / goals / topics keep the agent sidebar.
    ['/agent/agent-1/tasks', null, 'agent'],
    ['/agent/agent-1/goal/goal-1', null, 'agent'],
    ['/agent/agent-1/topics', null, 'agent'],
    ['/agent/agent-1/docs/doc-1', null, 'agent-docs'],
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
