'use client';

import { memo, useEffect } from 'react';

import { useGlobalStore } from '@/store/global';

/**
 * Gives Observation Mode (Fleet) its own persisted nav-panel collapse state.
 *
 * The nav panel is a single shared `DraggablePanel` driven by the global
 * `showLeftPanel` flag, so without this the running-task list inherits whatever
 * collapse state the chat rail was left in — e.g. collapse the chat sidebar, open
 * Fleet, and the task list is collapsed too. We keep `showLeftPanel` as the live
 * runtime source of truth (titlebar toggle / hotkey / layout all keep reading it)
 * and instead swap it in/out around the Fleet view:
 *
 * - on enter: remember the chat rail's state, then apply Fleet's own (`showFleetPanel`)
 * - while active: mirror collapse changes into `showFleetPanel` so they survive reloads
 * - on exit: restore the chat rail's remembered state
 *
 * Mirrors the save/restore approach used by the agent page's PortalAutoCollapse.
 */
const FleetPanelCollapseSync = memo(() => {
  useEffect(() => {
    const store = useGlobalStore;
    // Persist the user's raw left-panel intent.
    const savedShowLeftPanel = !!store.getState().status.showLeftPanel;

    // Fleet defaults to expanded the first time it's opened.
    const fleetExpand = store.getState().status.showFleetPanel ?? true;
    if (savedShowLeftPanel !== fleetExpand) store.getState().toggleLeftPanel(fleetExpand);

    // Persist Fleet's collapse state as the user toggles it (titlebar / hotkey),
    // so it's restored next time Observation Mode opens.
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.status.showLeftPanel !== prev.status.showLeftPanel) {
        store.getState().updateSystemStatus({ showFleetPanel: !!state.status.showLeftPanel });
      }
    });

    return () => {
      unsubscribe();
      if (!!store.getState().status.showLeftPanel !== savedShowLeftPanel) {
        store.getState().toggleLeftPanel(savedShowLeftPanel);
      }
    };
  }, []);

  return null;
});

FleetPanelCollapseSync.displayName = 'FleetPanelCollapseSync';

export default FleetPanelCollapseSync;
