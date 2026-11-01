import {
  type AgentLabelListItem,
  type SidebarAgentItem,
  type SidebarAgentLabel,
  type SidebarGroup,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { agentLabelService } from '@/services/agentLabel';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { AGENT_LABELS_KEY, agentLabelsResource } from './projection';

const n = setNamespace('label');

const LIST_PARAMS = {} as Record<string, never>;

/**
 * The registry keeps its long-standing flat field (`agentLabels`) as the
 * replica view, gated by `isAgentLabelsInit` so a loaded-but-empty registry
 * stays distinguishable from one that was never fetched.
 *
 * The cache scope (`${userId}:${workspaceId}`) owns the partition now: a switch
 * clears the view before paint (the replica's `useSync` resets the scope in a
 * layout effect), so the previous workspace's label ids can never be applied to
 * an agent here.
 */
const agentLabelsLens: ReplicaLens<HomeStore, AgentLabelListItem[]> = {
  clear: () => ({ agentLabels: [], isAgentLabelsInit: false }),
  get: (state) => (state.isAgentLabelsInit ? state.agentLabels : undefined),
  keys: (state) => (state.isAgentLabelsInit ? [AGENT_LABELS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { agentLabels: data, isAgentLabelsInit: true }
      : { agentLabels: [], isAgentLabelsInit: false },
};

type Setter = StoreSetter<HomeStore>;
export const createLabelSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new LabelActionImpl(set, get, _api);

export class LabelActionImpl {
  readonly #get: () => HomeStore;
  readonly #labels;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#labels = createReplicaSlice(agentLabelsResource, {
      actionPrefix: n('agentLabels'),
      fetcher: () => agentLabelService.getLabels(),
      get,
      // An unchanged registry must not re-render the picker / settings table.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'agentLabelsReplica',
      view: agentLabelsLens,
    });
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

  /**
   * Revalidate the registry of the current identity. The replica scope carries
   * the workspace, so this always refreshes the registry the caller is in —
   * never another scope's.
   */
  refreshAgentLabels = async (): Promise<void> => {
    await this.#labels.revalidate();
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
    const state = this.#get();
    const current = new Set(
      [...state.agentGroups.flatMap((g) => g.items), ...state.pinnedAgents]
        .concat(state.ungroupedAgents, state.privatePinnedAgents, state.privateUngroupedAgents)
        .concat(state.privateAgentGroups.flatMap((g) => g.items))
        .find((item) => item.id === agentId && item.type === 'agent')
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
      n('patchAgentLabels/optimistic'),
    );
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

  /**
   * Fetch orchestration for every surface that renders labels (sidebar, view-all
   * page, settings). The registry is read through `agentLabelSelectors`, not
   * from this return value; the layout effect inside `useSync` drops the
   * previous scope's registry before paint on a workspace switch.
   */
  useFetchAgentLabels = (isLogin: boolean | undefined): ReplicaSyncResult =>
    this.#labels.useSync(LIST_PARAMS, { enabled: isLogin === true });
}

export type LabelAction = Pick<LabelActionImpl, keyof LabelActionImpl>;
