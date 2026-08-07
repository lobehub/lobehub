import { describe, expect, it } from 'vitest';

import { resolveNavPanelKey } from './routeKey';

describe('resolveNavPanelKey', () => {
  it.each([
    ['/', null, 'home'],
    ['/lobe-team', 'lobe-team', 'home'],
    ['/tasks', null, 'home'],
    ['/lobe-team/task/task-1', 'lobe-team', 'home'],
    ['/agent/agent-1', null, 'agent'],
    ['/lobe-team/agent/agent-1', 'lobe-team', 'agent'],
    ['/group/group-1', null, 'group'],
    ['/settings/profile', null, 'settings'],
    ['/lobe-team/settings/general', 'lobe-team', 'workspace-settings'],
    ['/lobe-team/community', 'lobe-team', 'discover'],
    ['/lobe-team/resource', 'lobe-team', 'resource'],
    ['/lobe-team/resource/library', 'lobe-team', 'resourceLibrary'],
    ['/lobe-team/memory', 'lobe-team', 'memory'],
    ['/lobe-team/eval', 'lobe-team', 'eval'],
    ['/lobe-team/eval/bench/benchmark-1', 'lobe-team', 'evalBench'],
    ['/lobe-team/page/page-1', 'lobe-team', 'page'],
    ['/project/project-1', null, 'project'],
    ['/lobe-team/project/project-1/library/kb-1', 'lobe-team', 'project'],
    ['/lobe-team/image', 'lobe-team', 'image'],
    ['/lobe-team/video', 'lobe-team', 'video'],
  ])('maps %s to %s', (pathname, activeWorkspaceSlug, expected) => {
    expect(resolveNavPanelKey(pathname, activeWorkspaceSlug)).toBe(expected);
  });
});
