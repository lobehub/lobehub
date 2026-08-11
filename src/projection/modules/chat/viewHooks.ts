'use client';

import type { ChatTopicsIndex } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { chatTopicsViewContract } from './contracts';
import {
  type ChatTopicListItemView,
  selectChatTopicListItem,
  selectChatTopicsIndex,
} from './selectors';

export const useChatTopicsIndex = (
  surface: 'agentView' | 'sidebar',
  containerKey: string | undefined,
): ChatTopicsIndex | undefined => {
  useProjectionViewHydration(
    chatTopicsViewContract,
    { containerKey: containerKey ?? '', surface },
    Boolean(containerKey),
  );
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    if (!containerKey) return undefined;
    return selectChatTopicsIndex(state.scopes[scope], surface, containerKey);
  }, isEqual);
};

export const useChatTopicListItem = (id: string | undefined): ChatTopicListItemView | undefined => {
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    if (!projectionScope || !id) return undefined;
    return selectChatTopicListItem(projectionScope, id);
  }, isEqual);
};
