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
  setAvailableModes = (id: string, availableModes: McpAppViewState['availableModes']) => {
    const view = useMcpAppStore.getState().views[id];
    if (enabled() && view)
      useMcpAppStore.setState(
        (s) => ({ views: { ...s.views, [id]: { ...view, availableModes } } }),
        false,
        'mcpApp/setAvailableModes',
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
  close = (id: string, dismissed?: boolean) => {
    const view = useMcpAppStore.getState().views[id];
    if (view)
      useMcpAppStore.setState(
        (s) => ({
          ...(dismissed && {
            contexts: Object.fromEntries(Object.entries(s.contexts).filter(([key]) => key !== id)),
          }),
          views: {
            ...s.views,
            [id]: { ...view, dismissed: dismissed ?? view.dismissed, mode: 'inline' },
          },
        }),
        false,
        'mcpApp/close',
      );
  };
}
export const mcpAppActions = new McpAppActionImpl();
