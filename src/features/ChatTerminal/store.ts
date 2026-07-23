import debug from 'debug';
import { create } from 'zustand';

import { electronTerminalService } from '@/services/electron/terminal';

import { xtermManager } from './xtermManager';

const log = debug('lobe-desktop:chat-terminal');

export interface TerminalTab {
  id: string;
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
  closeTab: (topicKey: string, tabId: string) => void;
  createTab: (topicKey: string, cwd?: string) => Promise<void>;
  setActiveTab: (topicKey: string, tabId: string) => void;
}

const tabTitle = (cwd: string, shell: string) => {
  const dir = cwd
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop();
  return dir || shell.split(/[/\\]/).pop() || 'shell';
};

export const useChatTerminalStore = create<ChatTerminalActions & ChatTerminalState>()(
  (set, get) => ({
    activeTabIds: {},

    closeOtherTabs: (topicKey, tabId) => {
      const { activeTabIds, tabsByTopic } = get();
      const tabs = tabsByTopic[topicKey] ?? [];
      const kept = tabs.find((tab) => tab.id === tabId);
      if (!kept) return;
      for (const tab of tabs) if (tab.id !== tabId) xtermManager.close(tab.id);
      set({
        activeTabIds: { ...activeTabIds, [topicKey]: tabId },
        tabsByTopic: { ...tabsByTopic, [topicKey]: [kept] },
      });
    },

    closeTab: (topicKey, tabId) => {
      xtermManager.close(tabId);
      const { activeTabIds, tabsByTopic } = get();
      const tabs = (tabsByTopic[topicKey] ?? []).filter((tab) => tab.id !== tabId);
      const activeTabId =
        activeTabIds[topicKey] === tabId ? tabs.at(-1)?.id : activeTabIds[topicKey];
      set({
        activeTabIds: { ...activeTabIds, [topicKey]: activeTabId },
        tabsByTopic: { ...tabsByTopic, [topicKey]: tabs },
      });
    },

    createErrors: {},

    createTab: async (topicKey, cwd) => {
      if (get().creatingByTopic[topicKey]) return;
      set((s) => ({
        createErrors: { ...s.createErrors, [topicKey]: undefined },
        creatingByTopic: { ...s.creatingByTopic, [topicKey]: true },
      }));
      try {
        const info = await electronTerminalService.createSession({ cols: 80, cwd, rows: 24 });
        xtermManager.ensure(info.id);
        const { activeTabIds, tabsByTopic } = get();
        set({
          activeTabIds: { ...activeTabIds, [topicKey]: info.id },
          tabsByTopic: {
            ...tabsByTopic,
            [topicKey]: [
              ...(tabsByTopic[topicKey] ?? []),
              { id: info.id, title: tabTitle(info.cwd, info.shell) },
            ],
          },
        });
      } catch (error) {
        log('failed to create terminal session for %s: %O', topicKey, error);
        set((s) => ({
          createErrors: {
            ...s.createErrors,
            [topicKey]: error instanceof Error ? error.message : String(error),
          },
        }));
      } finally {
        set((s) => ({ creatingByTopic: { ...s.creatingByTopic, [topicKey]: false } }));
      }
    },

    creatingByTopic: {},

    setActiveTab: (topicKey, tabId) => {
      set({ activeTabIds: { ...get().activeTabIds, [topicKey]: tabId } });
    },

    tabsByTopic: {},
  }),
);

// When the shell process exits (user types `exit`, or the main process reaps an
// idle/LRU-evicted session), close its tab in whichever topic owns it.
xtermManager.onSessionExit((sessionId) => {
  const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
  const nextTabs: Record<string, TerminalTab[]> = {};
  const nextActive = { ...activeTabIds };
  for (const [topicKey, tabs] of Object.entries(tabsByTopic)) {
    const filtered = tabs.filter((tab) => tab.id !== sessionId);
    nextTabs[topicKey] = filtered;
    if (activeTabIds[topicKey] === sessionId) nextActive[topicKey] = filtered.at(-1)?.id;
  }
  useChatTerminalStore.setState({ activeTabIds: nextActive, tabsByTopic: nextTabs });
});
