/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { MIN_PANEL_HEIGHT, useDevDockStore } from './store';

const STORAGE_KEY = 'LOBE_DEV_DOCK_UI';

const readPersisted = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

describe('DevDock store', () => {
  beforeEach(() => {
    localStorage.clear();
    useDevDockStore.setState({
      activePanelId: null,
      expanded: true,
      maximized: false,
      panelHeight: 360,
      reactScan: false,
      scrollDebug: false,
    });
  });

  it('toggles a panel open and closed', () => {
    useDevDockStore.getState().togglePanel('feature-flags');
    expect(useDevDockStore.getState().activePanelId).toBe('feature-flags');

    useDevDockStore.getState().togglePanel('feature-flags');
    expect(useDevDockStore.getState().activePanelId).toBeNull();
  });

  it('switches between panels directly', () => {
    useDevDockStore.getState().togglePanel('feature-flags');
    useDevDockStore.getState().togglePanel('agent-mock');
    expect(useDevDockStore.getState().activePanelId).toBe('agent-mock');
  });

  it('clamps panel height to the minimum', () => {
    useDevDockStore.getState().setPanelHeight(10);
    expect(useDevDockStore.getState().panelHeight).toBe(MIN_PANEL_HEIGHT);
  });

  it('persists UI state to localStorage', () => {
    useDevDockStore.getState().setExpanded(false);
    useDevDockStore.getState().setScrollDebug(true);
    useDevDockStore.getState().setReactScan(true);

    expect(readPersisted()).toMatchObject({ expanded: false, reactScan: true, scrollDebug: true });
  });
});
