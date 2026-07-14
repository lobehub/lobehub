import { create } from 'zustand';

import { electronTerminalService } from '@/services/electron/terminal';

import { xtermManager } from './xtermManager';

export interface TerminalTab {
  id: string;
  title: string;
}

interface ChatTerminalState {
  /** Active tab per topic key */
  activeTabIds: Record<string, string | undefined>;
  creating: boolean;
  /** Terminal tabs per topic key — sessions created in a topic only show in that topic */
  tabsByTopic: Record<string, TerminalTab[]>;
}

interface ChatTerminalActions {
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

    creating: false,

    createTab: async (topicKey, cwd) => {
      if (get().creating) return;
      set({ creating: true });
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
      } finally {
        set({ creating: false });
      }
    },

    setActiveTab: (topicKey, tabId) => {
      set({ activeTabIds: { ...get().activeTabIds, [topicKey]: tabId } });
    },

    tabsByTopic: {},
  }),
);

// When the shell process exits (e.g. the user types `exit`), close its tab in
// whichever topic owns it.
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
