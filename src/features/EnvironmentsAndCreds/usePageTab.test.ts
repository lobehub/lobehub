import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { VAULT_TAB_SEARCH } from './const';
import { usePageTab } from './usePageTab';

const render = (initialEntry: string) =>
  renderHook(
    () => {
      const [tab, setTab] = usePageTab();
      return { search: useLocation().search, setTab, tab };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [initialEntry] }, children),
    },
  );

describe('usePageTab', () => {
  it('opens environments by default and on unknown values', () => {
    expect(render('/settings/environments').result.current.tab).toBe('environments');
    expect(render('/settings/environments?tab=nope').result.current.tab).toBe('environments');
  });

  it('opens the vault from the link old credential URLs redirect to', () => {
    expect(render(`/settings/environments${VAULT_TAB_SEARCH}`).result.current.tab).toBe('vault');
  });

  it('keeps the tab in the URL and leaves it clean for environments', () => {
    const { result } = render('/settings/environments?keep=1');

    act(() => result.current.setTab('vault'));
    expect(result.current.tab).toBe('vault');
    expect(result.current.search).toBe('?keep=1&tab=vault');

    act(() => result.current.setTab('environments'));
    expect(result.current.tab).toBe('environments');
    expect(result.current.search).toBe('?keep=1');
  });
});
