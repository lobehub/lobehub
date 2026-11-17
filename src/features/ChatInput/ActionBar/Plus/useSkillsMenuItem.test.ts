import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';

import { useSkillsMenuItem } from './useSkillsMenuItem';

vi.mock('@/utils/client/switchLang', () => ({ switchLang: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const initialStore = useGlobalStore.getState();
let persistedStatus: string | null;

beforeEach(() => {
  persistedStatus = localStorage.getItem('LOBE_SYSTEM_STATUS');
  useGlobalStore.setState({
    isStatusInit: true,
    status: {
      ...initialState.status,
      showRightPanel: false,
      showWorkingOverview: true,
      workingSidebarTab: 'files',
    },
  });
});

afterEach(() => {
  useGlobalStore.setState(initialStore, true);
  if (persistedStatus === null) localStorage.removeItem('LOBE_SYSTEM_STATUS');
  else localStorage.setItem('LOBE_SYSTEM_STATUS', persistedStatus);
  vi.restoreAllMocks();
});

describe('useSkillsMenuItem', () => {
  it('closes the composer menu before opening the skills sidebar', () => {
    const close = vi.fn(() => {
      expect(useGlobalStore.getState().status.showRightPanel).toBe(false);
    });
    const { result } = renderHook(() => useSkillsMenuItem(close));

    act(() => result.current.onClick());

    expect(close).toHaveBeenCalledOnce();
    expect(useGlobalStore.getState().status).toMatchObject({
      showRightPanel: true,
      showWorkingOverview: false,
      workingSidebarTab: 'skills',
      workingSidebarTabRequest: { tab: 'skills' },
    });
  });

  it('switches an already open sidebar from another tab to skills', () => {
    useGlobalStore.setState({
      status: { ...useGlobalStore.getState().status, showRightPanel: true },
    });
    const { result } = renderHook(() => useSkillsMenuItem(vi.fn()));

    act(() => result.current.onClick());

    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
    expect(useGlobalStore.getState().status.workingSidebarTab).toBe('skills');
  });

  it('keeps skills open on repeated clicks rather than toggling the panel closed', () => {
    const close = vi.fn();
    const { result } = renderHook(() => useSkillsMenuItem(close));

    act(() => result.current.onClick());
    act(() => result.current.onClick());

    expect(close).toHaveBeenCalledTimes(2);
    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
    expect(useGlobalStore.getState().status.workingSidebarTab).toBe('skills');
  });
});
