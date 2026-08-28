import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';

import { readBootShellGeometry } from './geometry';

const setStatus = (status: Partial<typeof INITIAL_STATUS>) =>
  useGlobalStore.setState({ status: { ...INITIAL_STATUS, ...status } });

beforeEach(() => {
  setStatus({});
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('readBootShellGeometry', () => {
  it('reads the panel layout from the store', () => {
    setStatus({ leftPanelWidth: 320, showLeftPanel: true });

    const geometry = readBootShellGeometry();

    expect(geometry.navPanelWidth).toBe(320);
    expect(geometry.showLeftPanel).toBe(true);
  });

  it('clamps the panel width to the draggable range', () => {
    setStatus({ leftPanelWidth: 9999 });
    expect(readBootShellGeometry().navPanelWidth).toBe(400);

    setStatus({ leftPanelWidth: 10 });
    expect(readBootShellGeometry().navPanelWidth).toBe(240);
  });

  it('falls back to the default width for an unusable persisted value', () => {
    setStatus({ leftPanelWidth: Number.NaN });

    expect(readBootShellGeometry().navPanelWidth).toBe(INITIAL_STATUS.leftPanelWidth);
  });

  it('follows the theme already resolved onto the document', () => {
    expect(readBootShellGeometry().isDark).toBe(false);

    document.documentElement.dataset.theme = 'dark';
    expect(readBootShellGeometry().isDark).toBe(true);
  });
});
