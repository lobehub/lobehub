import { useGlobalStore } from '@/store/global';
import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';

import {
  initialState,
  type McpAppConversationHost,
  type McpAppViewState,
  useMcpAppStore,
} from './store';

const enabled = () => {
  const state = getServerConfigStoreState();
  return !!state && serverConfigSelectors.enableMcpApps(state);
};
export const mcpAppTabKey = (id: string) => `mcp-app:${id}`;
export class McpAppActionImpl {
  reset = () => useMcpAppStore.setState(initialState, false, 'mcpApp/reset');
  registerHost = (scope: string, host: McpAppConversationHost) => {
    if (!enabled()) return () => {};
    useMcpAppStore.setState(
      (s) => ({ hosts: { ...s.hosts, [scope]: host } }),
      false,
      'mcpApp/registerHost',
    );
    return () => {
      if (useMcpAppStore.getState().hosts[scope] !== host) return;
      useMcpAppStore.setState(
        (s) => ({
          hosts: Object.fromEntries(Object.entries(s.hosts).filter(([key]) => key !== scope)),
        }),
        false,
        'mcpApp/unregisterHost',
      );
    };
  };
  registerPanel = (scope: string) => {
    if (!enabled()) return () => {};
    useMcpAppStore.setState(
      (s) => ({ panels: { ...s.panels, [scope]: true } }),
      false,
      'mcpApp/registerPanel',
    );
    return () =>
      useMcpAppStore.setState(
        (s) => ({ panels: { ...s.panels, [scope]: false } }),
        false,
        'mcpApp/unregisterPanel',
      );
  };
  registerView = (id: string, view: Omit<McpAppViewState, 'mode'>) => {
    if (!enabled()) return;
    useMcpAppStore.setState(
      (s) => ({
        views: {
          ...s.views,
          [id]: { ...s.views[id], mode: s.views[id]?.mode ?? 'inline', ...view },
        },
      }),
      false,
      'mcpApp/registerView',
    );
  };
  /**
   * Decide where a view lives from what its tool and resource declare
   * (`declared`), once. The side panel needs one in the view's conversation;
   * without it the view stays in its message. Only a call that completed in
   * this live conversation opens the panel by itself: a view loaded from
   * history waits there for the user to look.
   */
  place = (id: string, declared: 'inline' | 'fullscreen') => {
    const state = useMcpAppStore.getState();
    const view = state.views[id];
    if (!enabled() || !view || view.placed) return;
    const mode = declared === 'fullscreen' && state.panels[view.scope] ? 'fullscreen' : 'inline';
    useMcpAppStore.setState(
      { views: { ...state.views, [id]: { ...view, mode, placed: true } } },
      false,
      'mcpApp/place',
    );
    if (this.consumeLive(id) && mode === 'fullscreen')
      useGlobalStore.getState().openWorkingSidebar(mcpAppTabKey(id));
  };
  /** Show a view that lives in the side panel; its location doesn't change. */
  reveal = (id: string) => {
    const state = useMcpAppStore.getState();
    const view = state.views[id];
    if (enabled() && view?.mode === 'fullscreen' && state.panels[view.scope])
      useGlobalStore.getState().openWorkingSidebar(mcpAppTabKey(id));
  };
  /**
   * The app initialized and declared the modes it supports. The first time,
   * a location it can't run in gives way to `resolved`; later initializations
   * (the view remounting) keep where the app asked to be.
   */
  settle = (
    id: string,
    availableModes: McpAppViewState['availableModes'],
    resolved: 'inline' | 'fullscreen',
  ) => {
    const state = useMcpAppStore.getState();
    const view = state.views[id];
    if (!enabled() || !view) return;
    const move =
      !view.settled &&
      resolved !== view.mode &&
      (resolved === 'inline' || !!state.panels[view.scope]);
    useMcpAppStore.setState(
      {
        views: {
          ...state.views,
          [id]: { ...view, availableModes, settled: true, ...(move && { mode: resolved }) },
        },
      },
      false,
      'mcpApp/settle',
    );
  };
  markLive = (id: string) => {
    if (enabled() && !useMcpAppStore.getState().liveCalls[id])
      useMcpAppStore.setState(
        (s) => ({ liveCalls: { ...s.liveCalls, [id]: true } }),
        false,
        'mcpApp/markLive',
      );
  };
  forgetLive = (ids: string[]) => {
    const forgotten = new Set(ids);
    useMcpAppStore.setState(
      (s) => ({
        liveCalls: Object.fromEntries(
          Object.entries(s.liveCalls).filter(([id]) => !forgotten.has(id)),
        ),
      }),
      false,
      'mcpApp/forgetLive',
    );
  };
  consumeLive = (id: string) => {
    const live = enabled() && useMcpAppStore.getState().liveCalls[id];
    if (live)
      useMcpAppStore.setState(
        (s) => ({ liveCalls: { ...s.liveCalls, [id]: false } }),
        false,
        'mcpApp/consumeLive',
      );
    return !!live;
  };
  setMode = (id: string, mode: 'inline' | 'fullscreen') => {
    const state = useMcpAppStore.getState();
    const view = state.views[id];
    if (
      !enabled() ||
      !view ||
      !view.availableModes?.includes(mode) ||
      (mode === 'fullscreen' && !state.panels[view.scope])
    )
      return view?.mode ?? 'inline';
    useMcpAppStore.setState(
      { views: { ...state.views, [id]: { ...view, dismissed: false, mode } } },
      false,
      'mcpApp/setMode',
    );
    if (mode === 'fullscreen') useGlobalStore.getState().openWorkingSidebar(mcpAppTabKey(id));
    return mode;
  };
  /** The app asked to go away: it leaves both locations and its unsent context is dropped. */
  dismiss = (id: string) => {
    const view = useMcpAppStore.getState().views[id];
    if (view)
      useMcpAppStore.setState(
        (s) => ({
          contexts: Object.fromEntries(Object.entries(s.contexts).filter(([key]) => key !== id)),
          views: { ...s.views, [id]: { ...view, dismissed: true } },
        }),
        false,
        'mcpApp/dismiss',
      );
  };
}
export const mcpAppActions = new McpAppActionImpl();
