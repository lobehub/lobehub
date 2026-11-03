/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskDetailPath, useNavigateToTaskDetail, useTaskDetailPath } from './taskDetailPath';

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  navigate: vi.fn(),
  params: {} as { aid?: string },
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('taskDetailPath', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.params = {};
    mocks.activeWorkspaceSlug = null;
  });

  it('builds an agent-scoped path when an agent id is provided', () => {
    expect(taskDetailPath('T-1', 'agt_owner')).toBe('/agent/agt_owner/task/T-1');
  });

  it('falls back to the global task path without an agent id', () => {
    expect(taskDetailPath('T-1')).toBe('/task/T-1');
  });

  it('appends a readable title slug when the title is known', () => {
    expect(taskDetailPath('T-1', undefined, 'Ship the Thing')).toBe('/task/T-1/ship-the-thing');
    expect(taskDetailPath('T-1', 'agt_owner', '飞书适配器支持 POST 图文消息')).toBe(
      '/agent/agt_owner/task/T-1/飞书适配器支持-post-图文消息',
    );
  });

  it('stays at the bare id path when the title yields no slug', () => {
    expect(taskDetailPath('T-1', undefined, '')).toBe('/task/T-1');
    expect(taskDetailPath('T-1', undefined, null)).toBe('/task/T-1');
    expect(taskDetailPath('T-1', undefined, '!!! ???')).toBe('/task/T-1');
  });

  it('uses the route agent by default and allows explicit assignee override', () => {
    mocks.params = { aid: 'agt_current' };

    const { result } = renderHook(() => useTaskDetailPath());

    expect(result.current('T-1')).toBe('/agent/agt_current/task/T-1');
    expect(result.current('T-2', 'agt_child')).toBe('/agent/agt_child/task/T-2');
  });

  it('navigates to an explicit assignee route when provided', () => {
    mocks.params = { aid: 'agt_current' };

    const { result } = renderHook(() => useNavigateToTaskDetail());
    result.current('T-2', 'agt_child');

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_child/task/T-2');
  });

  it('carries the title through the navigate helper', () => {
    const { result } = renderHook(() => useNavigateToTaskDetail());
    result.current('T-2', undefined, 'Ship the Thing');

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-2/ship-the-thing');
  });

  it('prefixes the navigation target with the active workspace slug', () => {
    mocks.params = { aid: 'agt_current' };
    mocks.activeWorkspaceSlug = 'lobehub';

    const { result } = renderHook(() => useNavigateToTaskDetail());
    result.current('T-2', 'agt_child');

    expect(mocks.navigate).toHaveBeenCalledWith('/lobehub/agent/agt_child/task/T-2');
  });
});
