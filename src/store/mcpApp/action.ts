import { useGlobalStore } from '@/store/global';
import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';

import {
  initialState,
  type McpAppConversationHost,
  type McpAppEntryState,
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
   * (`declared`), once. A view a side panel tab already shows stays there: the
   * tab is restored with the conversation, its location state is not. The side panel needs one in the view's conversation;
   * without it the view stays in its message. Only a call that completed in
   * this live conversation opens the panel by itself: a view loaded from
   * history waits there for the user to look.
   */
  place = (id: string, declared: 'inline' | 'fullscreen') => {
    const state = useMcpAppStore.getState();
    const view = state.views[id];
    if (!enabled() || !view || view.placed) return;
    const wanted = declared === 'fullscreen' || view.inPanel ? 'fullscreen' : 'inline';
    const mode = wanted === 'fullscreen' && state.panels[view.scope] ? 'fullscreen' : 'inline';
    const live = this.consumeLive(id);
    useMcpAppStore.setState(
      (s) => ({ views: { ...s.views, [id]: { ...view, live, mode, placed: true } } }),
      false,
      'mcpApp/place',
    );
    if (live && mode === 'fullscreen')
      useGlobalStore.getState().openWorkingSidebar(mcpAppTabKey(id));
  };
  /**
   * A host instance mounted the view's frame: from now on it is the one whose
   * app may end the view. A frame reopened elsewhere (the tab closed, then View)
   * takes over from the instance it replaces.
   */
  ownFrame = (id: string, owner: number) => {
    const view = useMcpAppStore.getState().views[id];
    if (!enabled() || !view || view.frameOwner === owner) return;
    useMcpAppStore.setState(
      (s) => ({ views: { ...s.views, [id]: { ...s.views[id], frameOwner: owner } } }),
      false,
      'mcpApp/ownFrame',
    );
  };
  /** Whether `owner` still runs the view's frame, so its app's requests still count. */
  ownsFrame = (id: string, owner: number) => {
    const current = useMcpAppStore.getState().views[id]?.frameOwner;
    return current === undefined || current === owner;
  };
  /**
   * Whether `request` is still the call a tab shows: an older instance of the
   * tab (closed and reopened since) must not act on the current one.
   */
  isCurrentEntry = (id: string, request: number | undefined) =>
    request !== undefined && useMcpAppStore.getState().entries[id]?.request === request;
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
    // A live call the app moves to the side panel opens there, as placing it would have
    if (move && resolved === 'fullscreen' && view.live)
      useGlobalStore.getState().openWorkingSidebar(mcpAppTabKey(id));
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
  /**
   * Numbers every entrypoint call, across tabs: a tab closed and reopened while
   * its first call runs must not give the new call a number the old one has.
   */
  #lastEntryRequest = 0;
  /** An entrypoint tab starts its `{}` tool call; returns the call's number, 0 when off. */
  startEntry = (id: string) => {
    if (!enabled()) return 0;
    const request = ++this.#lastEntryRequest;
    useMcpAppStore.setState(
      (s) => ({ entries: { ...s.entries, [id]: { request, status: 'opening' } } }),
      false,
      'mcpApp/startEntry',
    );
    return request;
  };
  /** The call answered; only the latest one started for the tab counts. */
  settleEntry = (id: string, request: number, result?: McpAppEntryState['result']) => {
    if (useMcpAppStore.getState().entries[id]?.request !== request) return;
    useMcpAppStore.setState(
      (s) => ({
        entries: {
          ...s.entries,
          [id]: { request, result, status: result ? 'ready' : 'error' },
        },
      }),
      false,
      'mcpApp/settleEntry',
    );
  };
  /** The tab closed: opening it again calls the tool afresh. */
  forgetEntries = (ids: string[]) => {
    const gone = new Set(ids);
    const { entries } = useMcpAppStore.getState();
    if (!Object.keys(entries).some((id) => gone.has(id))) return;
    useMcpAppStore.setState(
      { entries: Object.fromEntries(Object.entries(entries).filter(([id]) => !gone.has(id))) },
      false,
      'mcpApp/forgetEntries',
    );
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
