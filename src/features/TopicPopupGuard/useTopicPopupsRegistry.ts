import { type TopicPopupInfo } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';

import { ensureElectronIpc } from '@/utils/electron/ipc';

interface TopicPopupsRegistryState {
  initialized: boolean;
  popups: TopicPopupInfo[];
  setPopups: (popups: TopicPopupInfo[]) => void;
}

const useTopicPopupsRegistryStore = create<TopicPopupsRegistryState>((set) => ({
  initialized: false,
  popups: [],
  setPopups: (popups) => set({ initialized: true, popups }),
}));

/**
 * Subscribe the main SPA to popup-registry updates from the Electron main
 * process. Safe to call from multiple components — the subscription is
 * installed once at module load time and the store is shared.
 *
 * On first use, fetches the initial list so callers don't have to wait
 * for the first broadcast to fire.
 */
let subscribed = false;

const ensureSubscribed = () => {
  if (subscribed) return;
  subscribed = true;

  const ipcRenderer = (typeof window !== 'undefined' && window.electron?.ipcRenderer) || null;
  if (!ipcRenderer) return;

  const setPopups = useTopicPopupsRegistryStore.getState().setPopups;

  const handler = (_event: unknown, data: { popups: TopicPopupInfo[] }) => {
    setPopups(data?.popups ?? []);
  };

  ipcRenderer.on('topicPopupsChanged' as any, handler);

  // Fetch initial snapshot so the guard renders correctly on reload into a
  // route that already has a popup open.
  void ensureElectronIpc()
    .windows.listTopicPopups()
    .then((popups: TopicPopupInfo[] | undefined) => {
      setPopups(popups ?? []);
    })
    .catch(() => {
      // No-op: IPC may not be available on every platform.
    });
};

interface ScopeQuery {
  agentId?: string;
  groupId?: string;
  topicId: string;
}

interface PopupScope {
  agentId?: string;
  groupId?: string;
}

const findPopup = (popups: TopicPopupInfo[], scope: ScopeQuery): TopicPopupInfo | undefined =>
  popups.find((p) => {
    if (p.topicId !== scope.topicId) return false;
    if (scope.groupId) return p.scope === 'group' && p.groupId === scope.groupId;
    if (scope.agentId) return p.scope === 'agent' && p.agentId === scope.agentId;
    return false;
  });

export const useTopicPopupsRegistry = () => {
  useEffect(() => {
    ensureSubscribed();
  }, []);
  return useTopicPopupsRegistryStore((s) => s.popups);
};

export const useTopicInPopup = (scope: ScopeQuery): TopicPopupInfo | undefined => {
  useEffect(() => {
    ensureSubscribed();
  }, []);
  const popups = useTopicPopupsRegistryStore((s) => s.popups);
  // Recompute when either the popup list or the caller's scope changes.
  return useMemo(
    () => findPopup(popups, scope),
    [popups, scope.agentId, scope.groupId, scope.topicId],
  );
};

export const useFocusTopicPopup = (scope: PopupScope) => {
  useEffect(() => {
    ensureSubscribed();
  }, []);
  const popups = useTopicPopupsRegistryStore((s) => s.popups);

  return useCallback(
    async (topicId?: string) => {
      if (!topicId) return false;

      const popup = findPopup(popups, { ...scope, topicId });
      if (!popup) return false;

      try {
        await ensureElectronIpc().windows.focusTopicPopup({ identifier: popup.identifier });
        return true;
      } catch (error) {
        console.error('[useFocusTopicPopup] Failed to focus popup window:', error);
        return false;
      }
    },
    [popups, scope.agentId, scope.groupId],
  );
};
