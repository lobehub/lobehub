import {
  type AgentLabelListItem,
  type SidebarAgentItem,
  type SidebarAgentLabel,
  type SidebarGroup,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentLabelKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  getHomeSidebarProjection,
  getProjectionStoreState,
  homeSidebarSelectors,
} from '@/projection';
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
    // Revalidate the key for the scope the registry was loaded for, not a
    // hardcoded one — the key carries the workspace, so mutating inside a
    // workspace must not refresh the personal list instead.
    await mutate(agentLabelKeys.list(true, this.#get().agentLabelsWorkspaceId));
  };

  removeAgentLabel = async (id: string): Promise<void> => {
    await agentLabelService.removeLabel(id);
    // deleting a label also drops its assignments, so the agent list changes too
    await Promise.all([this.refreshAgentLabels(), this.#get().refreshAgentList()]);
  };

  /**
   * Toggle one label on an agent. Optimistically patches the same way
   * `setAgentLabels` does, but the server call carries only the delta so a
   * concurrent editor's assignment survives.
   */
  toggleAgentLabel = async (agentId: string, labelId: string, assigned: boolean): Promise<void> => {
    const sidebar = getHomeSidebarProjection();
    const current = new Set(
      homeSidebarSelectors
        .getAgentById(agentId)(sidebar)
        ?.labels?.map((label) => label.id) ?? [],
    );

    if (assigned) current.add(labelId);
    else current.delete(labelId);

    this.#patchAgentLabels(agentId, [...current]);

    try {
      await agentLabelService.toggleAgentLabel(agentId, labelId, assigned);
    } catch (error) {
      await this.#get().refreshAgentList();
      throw error;
    }

    await Promise.all([this.refreshAgentLabels(), this.#get().refreshAgentList()]);
  };

  /**
   * Optimistic: patch the agent's labels in every list bucket immediately —
   * waiting for the mutation + full list refetch reads as lag. Name-sorted to
   * match the server's ordering, so the refresh doesn't reshuffle.
   */
  #patchAgentLabels = (agentId: string, labelIds: string[]) => {
    const state = this.#get();
    const sidebar = getHomeSidebarProjection();
    if (!sidebar) return;
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

    getProjectionStoreState().commitHomeSidebar(getCacheScope(), {
      groups: patchGroups(sidebar.groups),
      pinned: patchItems(sidebar.pinned),
      privateGroups: patchGroups(sidebar.privateGroups),
      privatePinned: patchItems(sidebar.privatePinned),
      privateUngrouped: patchItems(sidebar.privateUngrouped),
      ungrouped: patchItems(sidebar.ungrouped),
    });
  };

  setAgentLabels = async (agentId: string, labelIds: string[]): Promise<void> => {
    this.#patchAgentLabels(agentId, labelIds);

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

  useFetchAgentLabels = (
    isLogin: boolean | undefined,
    workspaceId: string | null | undefined,
  ): SWRResponse<AgentLabelListItem[]> => {
    const scopeId = workspaceId ?? null;

    // Changing the SWR key refetches, but the store keeps serving the previous
    // scope's registry until that request lands. Drop it immediately instead:
    // an empty picker is a moment of missing UI, while a picker holding
    // foreign label ids is a destructive write waiting to happen.
    useEffect(() => {
      if (this.#get().agentLabelsWorkspaceId === scopeId) return;

      this.#set(
        { agentLabels: [], agentLabelsWorkspaceId: scopeId, isAgentLabelsInit: false },
        false,
        n('useFetchAgentLabels/scopeChanged'),
      );
    }, [scopeId]);

    return useClientDataSWR<AgentLabelListItem[]>(
      isLogin === true ? agentLabelKeys.list(isLogin, scopeId) : null,
      () => agentLabelService.getLabels(),
      {
        onSuccess: (data) => {
          const state = this.#get();
          if (
            state.isAgentLabelsInit &&
            state.agentLabelsWorkspaceId === scopeId &&
            isEqual(state.agentLabels, data)
          )
            return;

          this.#set(
            { agentLabels: data, agentLabelsWorkspaceId: scopeId, isAgentLabelsInit: true },
            false,
            n('useFetchAgentLabels/onSuccess'),
          );
        },
      },
    );
  };
}

export type LabelAction = Pick<LabelActionImpl, keyof LabelActionImpl>;
