import { t } from 'i18next';

import { message } from '@/components/AntdStaticMethods';
import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { homeService } from '@/services/home';
import { sessionService } from '@/services/session';
import { getAgentStoreState } from '@/store/agent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { type SessionGroupItemBase } from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('sidebarUI');

type Setter = StoreSetter<HomeStore>;
export const createSidebarUISlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new SidebarUIActionImpl(set, get, _api);

export class SidebarUIActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  duplicateAgent = async (agentId: string, newTitle?: string): Promise<void> => {
    const messageLoadingKey = 'duplicateAgent.loading';

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    const result = await agentService.duplicateAgent(agentId, newTitle);

    if (!result) {
      message.destroy(messageLoadingKey);
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await this.#get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new agent
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.agentId);
  };

  duplicateAgentGroup = async (groupId: string, newTitle?: string): Promise<void> => {
    const messageLoadingKey = 'duplicateAgentGroup.loading';

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    const result = await chatGroupService.duplicateGroup(groupId, newTitle);

    if (!result) {
      message.destroy(messageLoadingKey);
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await this.#get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new group (using supervisor agent id)
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.supervisorAgentId);
  };

  pinAgent = async (agentId: string, pinned: boolean): Promise<void> => {
    await agentService.updateAgentPinned(agentId, pinned);
    await this.#get().refreshAgentList();
  };

  pinAgentGroup = async (groupId: string, pinned: boolean): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { pinned });
    await this.#get().refreshAgentList();
  };

  removeAgent = async (agentId: string): Promise<void> => {
    await agentService.removeAgent(agentId);
    await this.#get().refreshAgentList();
  };

  removeAgentGroup = async (groupId: string): Promise<void> => {
    // Delete the group
    await chatGroupService.deleteGroup(groupId);
    await this.#get().refreshAgentList();
  };

  renameAgentGroup = async (groupId: string, title: string): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { title });
    await this.#get().refreshAgentList();
  };

  updateAgentGroup = async (agentId: string, groupId: string | null): Promise<void> => {
    await homeService.updateAgentSessionGroupId(agentId, groupId === 'default' ? null : groupId);
    await this.#get().refreshAgentList();
  };

  addGroup = async (name: string): Promise<string> => {
    const id = await sessionService.createSessionGroup(name);
    await this.#get().refreshAgentList();
    return id;
  };

  removeGroup = async (groupId: string): Promise<void> => {
    await sessionService.removeSessionGroup(groupId);
    await this.#get().refreshAgentList();
  };

  updateGroupName = async (groupId: string, name: string): Promise<void> => {
    await sessionService.updateSessionGroup(groupId, { name });
    await this.#get().refreshAgentList();
  };

  updateGroupSort = async (items: SessionGroupItemBase[]): Promise<void> => {
    const sortMap = items.map((item, index) => ({ id: item.id, sort: index }));

    message.loading({
      content: t('sessionGroup.sorting', { ns: 'chat' }),
      duration: 0,
      key: 'updateGroupSort',
    });

    await sessionService.updateSessionGroupOrder(sortMap);
    message.destroy('updateGroupSort');
    message.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

    await this.#get().refreshAgentList();
  };

  setAgentRenamingId = (id: string | null): void => {
    this.#set({ agentRenamingId: id }, false, n('setAgentRenamingId'));
  };

  setAgentUpdatingId = (id: string | null): void => {
    this.#set({ agentUpdatingId: id }, false, n('setAgentUpdatingId'));
  };

  setGroupRenamingId = (id: string | null): void => {
    this.#set({ groupRenamingId: id }, false, n('setGroupRenamingId'));
  };

  setGroupUpdatingId = (id: string | null): void => {
    this.#set({ groupUpdatingId: id }, false, n('setGroupUpdatingId'));
  };
}

export type SidebarUIAction = Pick<SidebarUIActionImpl, keyof SidebarUIActionImpl>;
