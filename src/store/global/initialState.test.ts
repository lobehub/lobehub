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

  it('restores the Home customizations that decide layout on first paint', () => {
    seed({ hiddenHomeWidgets: ['news', 'suggestions'], showHomePortrait: false });

    const status = createInitialSystemStatus();

    expect(status.showHomePortrait).toBe(false);
    expect(status.hiddenHomeWidgets).toEqual(['news', 'suggestions']);
  });

  it('falls back to defaults when nothing is persisted', () => {
    const status = createInitialSystemStatus();

    expect(status.leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
    expect(status.showHomeRail).toBe(INITIAL_STATUS.showHomeRail);
    expect(status.showLeftPanel).toBe(INITIAL_STATUS.showLeftPanel);
    expect(status.showHomePortrait).toBe(INITIAL_STATUS.showHomePortrait);
    expect(status.hiddenHomeWidgets).toEqual(INITIAL_STATUS.hiddenHomeWidgets);
  });

  it('ignores persisted values of the wrong type', () => {
    seed({
      hiddenHomeWidgets: 'news',
      leftPanelWidth: '360',
      showHomePortrait: 'false',
      showLeftPanel: 'false',
    });

    const status = createInitialSystemStatus();

    expect(status.leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
    expect(status.showLeftPanel).toBe(INITIAL_STATUS.showLeftPanel);
    expect(status.showHomePortrait).toBe(INITIAL_STATUS.showHomePortrait);
    expect(status.hiddenHomeWidgets).toEqual(INITIAL_STATUS.hiddenHomeWidgets);
  });

  it('survives a corrupted payload', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(createInitialSystemStatus().leftPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
  });
});
