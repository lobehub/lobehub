'use client';

import type { AgentGroupDetail, ChatGroupProjection } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { chatGroupDetailViewContract } from './contracts';
import { selectChatGroupDetail } from './selectors';

export interface ChatGroupProjectionState {
  data?: AgentGroupDetail;
  /** Distinguishes an absent Projection from a tombstoned/incomplete one. */
  hasRecord: boolean;
  record?: ChatGroupProjection;
}

/** Reactive canonical ChatGroup detail used by request compatibility hooks. */
export const useChatGroupProjectionState = (id: string | undefined): ChatGroupProjectionState => {
  useProjectionViewHydration(chatGroupDetailViewContract, { id: id ?? '' }, Boolean(id));
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const record = id ? projectionScope?.records.chatGroup[id] : undefined;
    return {
      data: projectionScope && id ? selectChatGroupDetail(projectionScope, id) : undefined,
      hasRecord: Boolean(record),
      record,
    };
  }, isEqual);
};
