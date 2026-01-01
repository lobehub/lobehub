import { produce } from 'immer';
import type { StateCreator } from 'zustand/vanilla';

import { INBOX_SESSION_ID } from '@/const/session';
import { SESSION_CHAT_URL } from '@/const/url';
import type { GlobalStore } from '@/store/global';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('w');

export interface GlobalWorkspacePaneAction {
  switchBackToChat: (sessionId?: string) => void;
  toggleAgentSystemRoleExpand: (agentId: string, expanded?: boolean) => void;
  toggleCommandMenu: (visible?: boolean) => void;
  toggleExpandInputActionbar: (expand?: boolean) => void;
  toggleExpandSessionGroup: (id: string, expand: boolean) => void;
  toggleLeftPanel: (visible?: boolean) => void;
  toggleMobilePortal: (visible?: boolean) => void;
  toggleMobileTopic: (visible?: boolean) => void;
  toggleRightPanel: (visible?: boolean) => void;
  toggleSystemRole: (visible?: boolean) => void;
  toggleWideScreen: (enable?: boolean) => void;
  toggleZenMode: () => void;
}

export const globalWorkspaceSlice: StateCreator<
  GlobalStore,
  [['zustand/devtools', never]],
  [],
  GlobalWorkspacePaneAction
> = (set, get) => ({
  switchBackToChat: (sessionId) => {
    const target = SESSION_CHAT_URL(sessionId || INBOX_SESSION_ID, get().isMobile);
    get().navigate?.(target);
  },

  toggleAgentSystemRoleExpand: (agentId, expanded) => {
    const { status } = get();
    const systemRoleExpandedMap = status.systemRoleExpandedMap || {};
    const nextExpanded = typeof expanded === 'boolean' ? expanded : !systemRoleExpandedMap[agentId];

    get().updateSystemStatus(
      {
        systemRoleExpandedMap: {
          ...systemRoleExpandedMap,
          [agentId]: nextExpanded,
        },
      },
      n('toggleAgentSystemRoleExpand', { agentId, expanded: nextExpanded }),
    );
  },

  toggleCommandMenu: (visible) => {
    const currentVisible = get().status.showCommandMenu;
    get().updateSystemStatus({
      showCommandMenu: typeof visible === 'boolean' ? visible : !currentVisible,
    });
  },
  toggleExpandInputActionbar: (newValue) => {
    const expandInputActionbar =
      typeof newValue === 'boolean' ? newValue : !get().status.expandInputActionbar;

    get().updateSystemStatus({ expandInputActionbar }, n('toggleExpandInputActionbar', newValue));
  },
  toggleExpandSessionGroup: (id, expand) => {
    const { status } = get();
    const nextExpandSessionGroup = produce(status.expandSessionGroupKeys, (draft: string[]) => {
      if (expand) {
        if (draft.includes(id)) return;
        draft.push(id);
      } else {
        const index = draft.indexOf(id);
        if (index !== -1) draft.splice(index, 1);
      }
    });
    get().updateSystemStatus({ expandSessionGroupKeys: nextExpandSessionGroup });
  },
  toggleLeftPanel: (newValue) => {
    const showLeftPanel = typeof newValue === 'boolean' ? newValue : !get().status.showLeftPanel;
    get().updateSystemStatus({ showLeftPanel }, n('toggleLeftPanel', newValue));
  },
  toggleMobilePortal: (newValue) => {
    const mobileShowPortal =
      typeof newValue === 'boolean' ? newValue : !get().status.mobileShowPortal;

    get().updateSystemStatus({ mobileShowPortal }, n('toggleMobilePortal', newValue));
  },
  toggleMobileTopic: (newValue) => {
    const mobileShowTopic =
      typeof newValue === 'boolean' ? newValue : !get().status.mobileShowTopic;

    get().updateSystemStatus({ mobileShowTopic }, n('toggleMobileTopic', newValue));
  },

  toggleRightPanel: (newValue) => {
    const showRightPanel = typeof newValue === 'boolean' ? newValue : !get().status.showRightPanel;

    get().updateSystemStatus({ showRightPanel }, n('toggleRightPanel', newValue));
  },
  toggleSystemRole: (newValue) => {
    const showSystemRole = typeof newValue === 'boolean' ? newValue : !get().status.mobileShowTopic;

    get().updateSystemStatus({ showSystemRole }, n('toggleMobileTopic', newValue));
  },
  toggleWideScreen: (newValue) => {
    const noWideScreen = typeof newValue === 'boolean' ? !newValue : !get().status.noWideScreen;

    get().updateSystemStatus({ noWideScreen }, n('toggleWideScreen', newValue));
  },
  toggleZenMode: () => {
    const { status } = get();
    const nextZenMode = !status.zenMode;

    get().updateSystemStatus({ zenMode: nextZenMode }, n('toggleZenMode'));
  },
});
