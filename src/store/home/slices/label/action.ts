import {
  type AgentLabelListItem,
  type SidebarAgentItem,
  type SidebarAgentLabel,
  type SidebarGroup,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentLabelKeys } from '@/libs/swr/keys';
import { agentLabelService } from '@/services/agentLabel';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('label');

type Setter = StoreSetter<HomeStore>;
export const createLabelSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new LabelActionImpl(set, get, _api);

export class LabelActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createAgentLabel = async (params: {
    color?: string;
    description?: string;
    name: string;
  }): Promise<string | undefined> => {
    const id = await agentLabelService.createLabel(params);
    await this.refreshAgentLabels();
    return id;
  };

  refreshAgentLabels = async (): Promise<void> => {
    await mutate(agentLabelKeys.list(true));
  };

  removeAgentLabel = async (id: string): Promise<void> => {
    await agentLabelService.removeLabel(id);
    // deleting a label also drops its assignments, so the agent list changes too
    await Promise.all([this.refreshAgentLabels(), this.#get().refreshAgentList()]);
  };

  setAgentLabels = async (agentId: string, labelIds: string[]): Promise<void> => {
    // Optimistic: patch the agent's labels in every list bucket immediately —
    // waiting for the mutation + full list refetch reads as lag. Name-sorted
    // to match the server's ordering, so the refresh doesn't reshuffle.
    const state = this.#get();
    const nextLabels: SidebarAgentLabel[] = state.agentLabels
      .filter((label) => labelIds.includes(label.id))
      .map(({ color, id, name }) => ({ color, id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const patchItems = (items: SidebarAgentItem[]) =>
      items.map((item) =>
        item.id === agentId && item.type === 'agent' ? { ...item, labels: nextLabels } : item,
      );
    const patchGroups = (groups: SidebarGroup[]) =>
      groups.map((group) => ({ ...group, items: patchItems(group.items) }));

    this.#set(
      {
        agentGroups: patchGroups(state.agentGroups),
        pinnedAgents: patchItems(state.pinnedAgents),
        privateAgentGroups: patchGroups(state.privateAgentGroups),
        privatePinnedAgents: patchItems(state.privatePinnedAgents),
        privateUngroupedAgents: patchItems(state.privateUngroupedAgents),
        ungroupedAgents: patchItems(state.ungroupedAgents),
      },
      false,
      n('setAgentLabels/optimistic'),
    );

    try {
      await agentLabelService.setAgentLabels(agentId, labelIds);
    } catch (error) {
      // Roll back to server truth on failure.
      await this.#get().refreshAgentList();
      throw error;
    }

    await Promise.all([this.refreshAgentLabels(), this.#get().refreshAgentList()]);
  };

  updateAgentLabel = async (
    id: string,
    value: {
      archived?: boolean;
      color?: string | null;
      description?: string | null;
      name?: string;
    },
  ): Promise<void> => {
    await agentLabelService.updateLabel(id, value);
    // name/color render on agent rows — keep the list in sync
    await Promise.all([this.refreshAgentLabels(), this.#get().refreshAgentList()]);
  };

  useFetchAgentLabels = (isLogin: boolean | undefined): SWRResponse<AgentLabelListItem[]> => {
    return useClientDataSWR<AgentLabelListItem[]>(
      isLogin === true ? agentLabelKeys.list(isLogin) : null,
      () => agentLabelService.getLabels(),
      {
        onSuccess: (data) => {
          const state = this.#get();
          if (state.isAgentLabelsInit && isEqual(state.agentLabels, data)) return;

          this.#set(
            { agentLabels: data, isAgentLabelsInit: true },
            false,
            n('useFetchAgentLabels/onSuccess'),
          );
        },
      },
    );
  };
}

export type LabelAction = Pick<LabelActionImpl, keyof LabelActionImpl>;
