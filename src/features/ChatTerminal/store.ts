import debug from 'debug';
import { create } from 'zustand';

import { electronTerminalService } from '@/services/electron/terminal';

import { xtermManager } from './xtermManager';

const log = debug('lobe-desktop:chat-terminal');

export interface TerminalPane {
  /** Relative width inside the tab — only meaningful against sibling panes */
  flex: number;
  /** PTY session id */
  id: string;
}

export interface TerminalTab {
  activePaneId: string;
  /** Equals the id of the session the tab was opened with */
  id: string;
  panes: TerminalPane[];
  title: string;
}

interface ChatTerminalState {
  /** Active tab per topic key */
  activeTabIds: Record<string, string | undefined>;
  /** Last session-creation failure per topic key — rendered as the panel's error state */
  createErrors: Record<string, string | undefined>;
  /** Per topic key, so a create in-flight for one topic doesn't block another */
  creatingByTopic: Record<string, boolean>;
  /** Terminal tabs per topic key — sessions created in a topic only show in that topic */
  tabsByTopic: Record<string, TerminalTab[]>;
}

interface ChatTerminalActions {
  closeOtherTabs: (topicKey: string, tabId: string) => void;
  closePane: (topicKey: string, paneId: string) => void;
  closeTab: (topicKey: string, tabId: string) => void;
  createTab: (topicKey: string, cwd?: string) => Promise<void>;
  setActivePane: (topicKey: string, tabId: string, paneId: string) => void;
  setActiveTab: (topicKey: string, tabId: string) => void;
  setPaneFlex: (topicKey: string, tabId: string, flex: number[]) => void;
  splitPane: (topicKey: string, tabId: string, cwd?: string) => Promise<void>;
}

const tabTitle = (cwd: string, shell: string) => {
  const dir = cwd
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop();
  return dir || shell.split(/[/\\]/).pop() || 'shell';
};

/** Drops the pane from whichever tab holds it, dropping the tab once it runs empty. */
const withoutPane = (tabs: TerminalTab[], paneId: string): TerminalTab[] =>
  tabs.flatMap((tab) => {
    if (!tab.panes.some((pane) => pane.id === paneId)) return [tab];
    const panes = tab.panes.filter((pane) => pane.id !== paneId);
    if (panes.length === 0) return [];
    return [
      {
        ...tab,
        activePaneId: tab.activePaneId === paneId ? panes.at(-1)!.id : tab.activePaneId,
        panes,
      },
    ];
  });

const reassignActiveTab = (
  tabs: TerminalTab[],
  activeTabId: string | undefined,
): string | undefined =>
  tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs.at(-1)?.id;

export const useChatTerminalStore = create<ChatTerminalActions & ChatTerminalState>()((
  set,
  get,
) => {
  // Shared by createTab and splitPane: both spawn a PTY and both are gated by
  // the same per-topic in-flight flag so a double click can't fork two shells.
  const spawnSession = async (topicKey: string, cwd?: string) => {
    if (get().creatingByTopic[topicKey]) return;
    set((s) => ({
      createErrors: { ...s.createErrors, [topicKey]: undefined },
      creatingByTopic: { ...s.creatingByTopic, [topicKey]: true },
    }));
    try {
      const info = await electronTerminalService.createSession({ cols: 80, cwd, rows: 24 });
      xtermManager.ensure(info.id);
      return info;
    } catch (error) {
      log('failed to create terminal session for %s: %O', topicKey, error);
      set((s) => ({
        createErrors: {
          ...s.createErrors,
          [topicKey]: error instanceof Error ? error.message : String(error),
        },
      }));
      return;
    } finally {
      set((s) => ({ creatingByTopic: { ...s.creatingByTopic, [topicKey]: false } }));
    }
  };

  const updateTab = (
    topicKey: string,
    tabId: string,
    update: (tab: TerminalTab) => TerminalTab,
  ) => {
    const { tabsByTopic } = get();
    const tabs = tabsByTopic[topicKey] ?? [];
    const next = tabs.map((tab) => (tab.id === tabId ? update(tab) : tab));
    // Bail on a no-op update — setActivePane runs on every pointerdown in a
    // pane, and a fresh tabsByTopic identity there would rerender the panel.
    if (next.every((tab, index) => tab === tabs[index])) return;
    set({ tabsByTopic: { ...tabsByTopic, [topicKey]: next } });
  };

  return {
    activeTabIds: {},

    closeOtherTabs: (topicKey, tabId) => {
      const { activeTabIds, tabsByTopic } = get();
      const tabs = tabsByTopic[topicKey] ?? [];
      const kept = tabs.find((tab) => tab.id === tabId);
      if (!kept) return;
      for (const tab of tabs) {
        if (tab.id === tabId) continue;
        for (const pane of tab.panes) xtermManager.close(pane.id);
      }
      set({
        activeTabIds: { ...activeTabIds, [topicKey]: tabId },
        tabsByTopic: { ...tabsByTopic, [topicKey]: [kept] },
      });
    },

    closePane: (topicKey, paneId) => {
      xtermManager.close(paneId);
      const { activeTabIds, tabsByTopic } = get();
      const tabs = withoutPane(tabsByTopic[topicKey] ?? [], paneId);
      set({
        activeTabIds: {
          ...activeTabIds,
          [topicKey]: reassignActiveTab(tabs, activeTabIds[topicKey]),
        },
        tabsByTopic: { ...tabsByTopic, [topicKey]: tabs },
      });
    },

    closeTab: (topicKey, tabId) => {
      const { activeTabIds, tabsByTopic } = get();
      const tabs = tabsByTopic[topicKey] ?? [];
      for (const tab of tabs) {
        if (tab.id !== tabId) continue;
        for (const pane of tab.panes) xtermManager.close(pane.id);
      }
      const kept = tabs.filter((tab) => tab.id !== tabId);
      set({
        activeTabIds: {
          ...activeTabIds,
          [topicKey]: reassignActiveTab(kept, activeTabIds[topicKey]),
        },
        tabsByTopic: { ...tabsByTopic, [topicKey]: kept },
      });
    },

    createErrors: {},

    createTab: async (topicKey, cwd) => {
      const info = await spawnSession(topicKey, cwd);
      if (!info) return;
      const { activeTabIds, tabsByTopic } = get();
      set({
        activeTabIds: { ...activeTabIds, [topicKey]: info.id },
        tabsByTopic: {
          ...tabsByTopic,
          [topicKey]: [
            ...(tabsByTopic[topicKey] ?? []),
            {
              activePaneId: info.id,
              id: info.id,
              panes: [{ flex: 1, id: info.id }],
              title: tabTitle(info.cwd, info.shell),
            },
          ],
        },
      });
    },

    creatingByTopic: {},

    setActivePane: (topicKey, tabId, paneId) => {
      updateTab(topicKey, tabId, (tab) =>
        tab.activePaneId === paneId || !tab.panes.some((pane) => pane.id === paneId)
          ? tab
          : { ...tab, activePaneId: paneId },
      );
    },

    setActiveTab: (topicKey, tabId) => {
      set({ activeTabIds: { ...get().activeTabIds, [topicKey]: tabId } });
    },

    setPaneFlex: (topicKey, tabId, flex) => {
      updateTab(topicKey, tabId, (tab) =>
        flex.length === tab.panes.length
          ? { ...tab, panes: tab.panes.map((pane, index) => ({ ...pane, flex: flex[index] })) }
          : tab,
      );
    },

    splitPane: async (topicKey, tabId, cwd) => {
      const info = await spawnSession(topicKey, cwd);
      if (!info) return;
      updateTab(topicKey, tabId, (tab) => {
        const found = tab.panes.findIndex((pane) => pane.id === tab.activePaneId);
        const sourceIndex = found === -1 ? tab.panes.length - 1 : found;
        // The new pane takes half of the pane it was split from, so the rest
        // of the row keeps whatever widths the user dragged them to.
        const half = tab.panes[sourceIndex].flex / 2;
        const panes = tab.panes.map((pane, index) =>
          index === sourceIndex ? { ...pane, flex: half } : pane,
        );
        panes.splice(sourceIndex + 1, 0, { flex: half, id: info.id });
        return { ...tab, activePaneId: info.id, panes };
      });
    },

    tabsByTopic: {},
  };
});

// ⌘⌥←/→ arrives on whichever pane has focus; only the store knows its neighbours.
xtermManager.onPaneNavigate((sessionId, direction) => {
  const { tabsByTopic, setActivePane } = useChatTerminalStore.getState();
  for (const [topicKey, tabs] of Object.entries(tabsByTopic)) {
    const tab = tabs.find((candidate) => candidate.panes.some((pane) => pane.id === sessionId));
    if (!tab) continue;
    const index = tab.panes.findIndex((pane) => pane.id === sessionId);
    // Directional, not cyclic — matches Ghostty's goto_split, which stops at the edge.
    const target = tab.panes[index + direction];
    if (!target) return;
    setActivePane(topicKey, tab.id, target.id);
    xtermManager.focus(target.id);
    return;
  }
});

// When a shell process exits (user types `exit`, or the main process reaps an
// idle/LRU-evicted session), drop its pane wherever it lives — and with it the
// tab, once that was its last pane.
xtermManager.onSessionExit((sessionId) => {
  const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
  const nextTabs: Record<string, TerminalTab[]> = {};
  const nextActive = { ...activeTabIds };
  for (const [topicKey, tabs] of Object.entries(tabsByTopic)) {
    const filtered = withoutPane(tabs, sessionId);
    nextTabs[topicKey] = filtered;
    nextActive[topicKey] = reassignActiveTab(filtered, activeTabIds[topicKey]);
  }
  useChatTerminalStore.setState({ activeTabIds: nextActive, tabsByTopic: nextTabs });
});
