import { afterEach, describe, expect, it } from 'vitest';

import { createInitialSystemStatus, INITIAL_STATUS } from './initialState';

const STORAGE_KEY = 'LOBE_SYSTEM_STATUS';

const seed = (value: unknown) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value));

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe('createInitialSystemStatus', () => {
  it('restores the shell-defining preferences synchronously', () => {
    seed({ leftPanelWidth: 360, showHomeRail: false, showLeftPanel: false });

    const status = createInitialSystemStatus();

    expect(status.leftPanelWidth).toBe(360);
    expect(status.showHomeRail).toBe(false);
    expect(status.showLeftPanel).toBe(false);
  });

  it('falls back to defaults when nothing is persisted', () => {
    const status = createInitialSystemStatus();

    expect(status.leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
    expect(status.showHomeRail).toBe(INITIAL_STATUS.showHomeRail);
    expect(status.showLeftPanel).toBe(INITIAL_STATUS.showLeftPanel);
  });

  it('ignores persisted values of the wrong type', () => {
    seed({ leftPanelWidth: '360', showLeftPanel: 'false' });

    const status = createInitialSystemStatus();

    expect(status.leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
    expect(status.showLeftPanel).toBe(INITIAL_STATUS.showLeftPanel);
  });

  it('survives a corrupted payload', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(createInitialSystemStatus().leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
  });
});
