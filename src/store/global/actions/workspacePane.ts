import { produce } from 'immer';

import { INBOX_SESSION_ID } from '@/const/session';
import { SESSION_CHAT_URL } from '@/const/url';
import { type GlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('w');

type Setter = StoreSetter<GlobalStore>;
export const globalWorkspaceSlice = (set: Setter, get: () => GlobalStore, _api?: unknown) =>
  new GlobalWorkspacePaneActionImpl(set, get, _api);

export class GlobalWorkspacePaneActionImpl {
  readonly #get: () => GlobalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => GlobalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  switchBackToChat = (sessionId?: string): void => {
    const target = SESSION_CHAT_URL(sessionId || INBOX_SESSION_ID, this.#get().isMobile);
    this.#get().navigate?.(target);
  };

  toggleAgentSystemRoleExpand = (agentId: string, expanded?: boolean): void => {
    const { status } = this.#get();
    const systemRoleExpandedMap = status.systemRoleExpandedMap || {};
    const nextExpanded = typeof expanded === 'boolean' ? expanded : !systemRoleExpandedMap[agentId];

    this.#get().updateSystemStatus(
      {
        systemRoleExpandedMap: {
          ...systemRoleExpandedMap,
          [agentId]: nextExpanded,
        },
      },
      n('toggleAgentSystemRoleExpand', { agentId, expanded: nextExpanded }),
    );
  };

  toggleCommandMenu = (visible?: boolean): void => {
    const currentVisible = this.#get().status.showCommandMenu;
    this.#get().updateSystemStatus({
      showCommandMenu: typeof visible === 'boolean' ? visible : !currentVisible,
    });
  };

  toggleExpandInputActionbar = (newValue?: boolean): void => {
    const expandInputActionbar =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.expandInputActionbar;

    this.#get().updateSystemStatus(
      { expandInputActionbar },
      n('toggleExpandInputActionbar', newValue),
    );
  };

  toggleExpandSessionGroup = (id: string, expand: boolean): void => {
    const { status } = this.#get();
    const nextExpandSessionGroup = produce(status.expandSessionGroupKeys, (draft: string[]) => {
      if (expand) {
        if (draft.includes(id)) return;
        draft.push(id);
      } else {
        const index = draft.indexOf(id);
        if (index !== -1) draft.splice(index, 1);
      }
    });
    this.#get().updateSystemStatus({ expandSessionGroupKeys: nextExpandSessionGroup });
  };

  toggleLeftPanel = (newValue?: boolean): void => {
    const showLeftPanel =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.showLeftPanel;
    this.#get().updateSystemStatus({ showLeftPanel }, n('toggleLeftPanel', newValue));
  };

  toggleMobilePortal = (newValue?: boolean): void => {
    const mobileShowPortal =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.mobileShowPortal;

    this.#get().updateSystemStatus({ mobileShowPortal }, n('toggleMobilePortal', newValue));
  };

  toggleMobileTopic = (newValue?: boolean): void => {
    const mobileShowTopic =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.mobileShowTopic;

    this.#get().updateSystemStatus({ mobileShowTopic }, n('toggleMobileTopic', newValue));
  };

  toggleRightPanel = (newValue?: boolean): void => {
    const showRightPanel =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.showRightPanel;

    this.#get().updateSystemStatus({ showRightPanel }, n('toggleRightPanel', newValue));
  };

  toggleSystemRole = (newValue?: boolean): void => {
    const showSystemRole =
      typeof newValue === 'boolean' ? newValue : !this.#get().status.mobileShowTopic;

    this.#get().updateSystemStatus({ showSystemRole }, n('toggleMobileTopic', newValue));
  };

  toggleWideScreen = (newValue?: boolean): void => {
    const noWideScreen =
      typeof newValue === 'boolean' ? !newValue : !this.#get().status.noWideScreen;

    this.#get().updateSystemStatus({ noWideScreen }, n('toggleWideScreen', newValue));
  };

  toggleZenMode = (): void => {
    const { status } = this.#get();
    const nextZenMode = !status.zenMode;

    this.#get().updateSystemStatus({ zenMode: nextZenMode }, n('toggleZenMode'));
  };
}

export type GlobalWorkspacePaneAction = Pick<
  GlobalWorkspacePaneActionImpl,
  keyof GlobalWorkspacePaneActionImpl
>;
