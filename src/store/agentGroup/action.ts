import { useEffect } from 'react';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import { mutate } from '@/libs/swr';
import { groupKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  chatGroupListViewContract,
  getProjectionStoreState,
  useProjectionViewHydration,
} from '@/projection';
import {
  chatGroupDetailProjectionQuery,
  chatGroupsProjectionQuery,
  loadChatGroupDetailProjection,
  loadChatGroupsProjection,
} from '@/projection/modules/chatGroup/queries';
import { useChatGroupProjectionState } from '@/projection/modules/chatGroup/viewHooks';
import { useProjectionRequest } from '@/projection/query/hook';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { type ResetableStore } from '@/store/utils/resetableStore';
import { setNamespace } from '@/utils/storeDebug';

import { type ChatGroupState, initialChatGroupState } from './initialState';
import { ChatGroupCurdAction } from './slices/curd';
import { ChatGroupLifecycleAction } from './slices/lifecycle';
import { ChatGroupMemberAction } from './slices/member';

const n = setNamespace('chatGroup');

type Setter = StoreSetter<ChatGroupStore>;
class ChatGroupInternalAction implements ResetableStore {
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatGroupState, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    void get;
  }

  reset: ResetableStore['reset'] = () => {
    this.#set(initialChatGroupState, false, n('reset'));
  };

  internal_fetchGroupDetail = async (groupId: string) => {
    const scope = getCacheScope();
    const resolvedGroup = await loadChatGroupDetailProjection(groupId, scope);
    if (!resolvedGroup) return;

    // Set activeAgentId to supervisor for correct model resolution
    if (resolvedGroup.supervisorAgentId) {
      getAgentStoreState().setActiveAgentId(resolvedGroup.supervisorAgentId);
      useChatStore.setState(
        { activeAgentId: resolvedGroup.supervisorAgentId },
        false,
        'syncActiveAgentIdFromAgentGroup',
      );
    }
  };

  internal_updateGroupMaps = (groups: ChatGroupItem[]) => {
    // Session rows are an indirect, partial ChatGroup source. They may seed an
    // empty Projection, but must never outrank a typed ChatGroup request or a
    // local edit that already owns the entity.
    getProjectionStoreState().commitChatGroups(getCacheScope(), groups, 0);
  };

  loadGroups = async () => {
    await loadChatGroupsProjection(getCacheScope());
  };

  refreshGroupDetail = async (groupId: string) => {
    await mutate(groupKeys.detail(groupId));
  };

  refreshGroups = async () => {
    await mutate(groupKeys.list(true));
  };

  toggleGroupSetting = (open: boolean) => {
    this.#set({ showGroupSetting: open }, false, 'toggleGroupSetting');
  };

  toggleThread = (agentId: string) => {
    this.#set({ activeThreadAgentId: agentId }, false, 'toggleThread');
  };

  useFetchGroupDetail = (enabled: boolean, groupId: string) => {
    const projection = useChatGroupProjectionState(enabled && groupId ? groupId : undefined);
    const request = useProjectionRequest(
      enabled && groupId ? groupKeys.detail(groupId) : null,
      chatGroupDetailProjectionQuery,
      { groupId },
    );

    useEffect(() => {
      const supervisorAgentId = projection.data?.supervisorAgentId;
      if (!request.data || !supervisorAgentId) return;

      const agentStore = getAgentStoreState();
      agentStore.setActiveAgentId(supervisorAgentId);
      useChatStore.setState(
        { activeAgentId: supervisorAgentId },
        false,
        'syncActiveAgentIdFromAgentGroup',
      );
    }, [projection.data?.supervisorAgentId, request.data]);

    return request;
  };

  // SWR Hooks for data fetching
  // This is not used for now, as we are combining group in the session lambda's response
  useFetchGroups = (enabled: boolean, isLogin: boolean) => {
    useProjectionViewHydration(chatGroupListViewContract, {}, enabled);
    return useProjectionRequest(
      enabled ? groupKeys.list(isLogin) : null,
      chatGroupsProjectionQuery,
      {},
    );
  };
}

type PublicActions<T> = { [K in keyof T]: T[K] };

// Combined action type (public methods only)
export type ChatGroupAction = PublicActions<
  ChatGroupInternalAction & ChatGroupLifecycleAction & ChatGroupMemberAction & ChatGroupCurdAction
>;

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (
  ...params: Parameters<
    StateCreator<ChatGroupStore, [['zustand/devtools', never]], [], ChatGroupAction>
  >
) =>
  flattenActions<ChatGroupAction>([
    new ChatGroupInternalAction(...params),
    new ChatGroupLifecycleAction(...params),
    new ChatGroupMemberAction(...params),
    new ChatGroupCurdAction(...params),
  ]);
