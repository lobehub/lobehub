/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemorySetting from './Memory';

const setSettingsMock = vi.hoisted(() => vi.fn());
const memorySettingsMock = vi.hoisted(() => ({ value: {} as { enabled?: boolean } }));

vi.mock('@/hooks/useSaveState', () => ({
  useSaveState: () => ({
    lastSavedAt: undefined,
    retry: vi.fn(),
    save: (callback: () => void) => callback(),
    status: 'idle',
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      defaultSettings: {},
      isUserStateInit: true,
      setSettings: setSettingsMock,
      settings: { memory: memorySettingsMock.value },
    }),
}));

vi.mock('@/components/Editor/AutoSaveHint', () => ({ default: () => null }));
vi.mock('@/const/layoutTokens', () => ({ FORM_STYLE: {} }));
vi.mock('@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider', () => ({
  default: () => null,
}));

describe('MemorySetting', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    memorySettingsMock.value = {};
  });

  it('shows memory as enabled when the setting has not been persisted', () => {
    render(<MemorySetting />);

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('persists toggle changes', () => {
    memorySettingsMock.value = { enabled: false };
    render(<MemorySetting />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(setSettingsMock).toHaveBeenCalledWith({ memory: { enabled: true } });
  });
});
