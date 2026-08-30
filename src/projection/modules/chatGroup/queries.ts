import { chatGroupService } from '@/services/chatGroup';

import { defineProjectionQuery, executeProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';
import { selectChatGroupDetail, selectChatGroupList } from './selectors';

export interface ChatGroupDetailQueryParams {
  groupId: string;
}

type ChatGroupDetailQueryResponse = Awaited<
  ReturnType<typeof chatGroupService.getGroupDetailWithAccess>
>;

export const chatGroupDetailProjectionQuery = defineProjectionQuery<
  ChatGroupDetailQueryParams,
  ChatGroupDetailQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    if (!result) {
      getProjectionStoreState().deleteChatGroupProjection(scope, params.groupId, observedAt);
      return;
    }

    getProjectionStoreState().commitChatGroupDetail(
      scope,
      result.data,
      { group: result.access, members: result.memberAccess },
      'network',
      observedAt,
    );
  },
  query: ({ groupId }) => chatGroupService.getGroupDetailWithAccess(groupId),
});

export const loadChatGroupDetailProjection = async (groupId: string, scope: string) => {
  await executeProjectionQuery(chatGroupDetailProjectionQuery, { groupId }, scope);
  return selectChatGroupDetail(getProjectionStoreState().scopes[scope], groupId);
};

type EmptyQueryParams = Record<string, never>;
type ChatGroupsQueryResponse = Awaited<ReturnType<typeof chatGroupService.getGroups>>;

export const chatGroupsProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  ChatGroupsQueryResponse
>({
  project: (groups, { observedAt, scope }) => {
    getProjectionStoreState().commitChatGroups(scope, groups, observedAt);
  },
  query: () => chatGroupService.getGroups(),
});

export const loadChatGroupsProjection = async (scope: string) => {
  await executeProjectionQuery(chatGroupsProjectionQuery, {}, scope);
  return selectChatGroupList(getProjectionStoreState().scopes[scope]);
};
