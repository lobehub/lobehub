import { BRANDING_NAME } from '@lobechat/business-const';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDesktopDocumentTitle } from './useDesktopDocumentTitle';

interface MockResolvedTab {
  isActive: boolean;
  meta: { title: string };
  tab: { id: string };
}

const mocks = vi.hoisted(() => ({
  result: { activeTabId: null as string | null, tabs: [] as unknown[] },
}));

vi.mock('@/features/Electron/titlebar/TabBar/hooks/useResolvedTabs', () => ({
  useResolvedTabs: () => mocks.result,
}));

const resolvedTab = (id: string, title: string): MockResolvedTab => ({
  isActive: false,
  meta: { title },
  tab: { id },
});

afterEach(() => {
  document.title = '';
  mocks.result = { activeTabId: null, tabs: [] };
});

describe('useDesktopDocumentTitle', () => {
  it('sets the active tab title with the branding suffix', () => {
    mocks.result = {
      activeTabId: 't1',
      tabs: [resolvedTab('t1', 'Chat A'), resolvedTab('t2', 'Other')],
    };

    renderHook(() => useDesktopDocumentTitle());

    expect(document.title).toBe(`Chat A · ${BRANDING_NAME}`);
  });

  it('emits the bare branding name when the resolved title is the brand fallback', () => {
    mocks.result = { activeTabId: 't1', tabs: [resolvedTab('t1', BRANDING_NAME)] };

    renderHook(() => useDesktopDocumentTitle());

    expect(document.title).toBe(BRANDING_NAME);
  });

  it('emits the bare branding name when there is no active tab', () => {
    renderHook(() => useDesktopDocumentTitle());

    expect(document.title).toBe(BRANDING_NAME);
  });
});
