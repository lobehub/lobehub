// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useGlobalStore } from '@/store/global';

import AgentViewAllSkeleton from './AgentViewAll';

const setCollapsed = (collapsed: boolean) =>
  useGlobalStore.setState((s) => ({
    status: { ...s.status, agentListSidebarSectionCollapsed: collapsed },
  }));

const render = () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(createElement(AgentViewAllSkeleton)));
  const count = (testId: string) => container.querySelectorAll(`[data-testid="${testId}"]`).length;
  return { count, unmount: () => act(() => root.unmount()) };
};

describe('AgentViewAllSkeleton', () => {
  afterEach(() => setCollapsed(false));

  // The loaded page puts the "In sidebar" block above the toolbar; a skeleton
  // without it dropped the toolbar and rows by the block's height on load.
  it('reserves the expanded "In sidebar" block above the toolbar', () => {
    const { count, unmount } = render();

    expect(count('agent-view-all-sidebar-skeleton')).toBe(1);
    expect(count('agent-view-all-sidebar-card-skeleton')).toBe(3);
    unmount();
  });

  it('keeps only the block header when the block is collapsed', () => {
    setCollapsed(true);
    const { count, unmount } = render();

    expect(count('agent-view-all-sidebar-skeleton')).toBe(1);
    expect(count('agent-view-all-sidebar-card-skeleton')).toBe(0);
    unmount();
  });
});
