'use client';

import type { ChatTopicsIndex } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { chatTopicsViewContract } from './contracts';
import {
  type ChatTopicListItemView,
  type ChatTopicsProjectionView,
  selectChatTopicItem,
  selectChatTopicListItem,
  selectChatTopicsIndex,
  selectChatTopicsView,
} from './selectors';

type EqualityFn<T> = (left: T, right: T) => boolean;

/** Subscribe directly to the current scope's canonical Chat Projection. */
export const useChatProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
  equalityFn?: EqualityFn<Selected>,
): Selected => {
  const scope = useCacheScope();
  return useProjectionStore((state) => selector(state.scopes[scope]), equalityFn);
};

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

export const useChatTopicProjection = (id: string | undefined) => {
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    if (!id) return undefined;
    return selectChatTopicItem(state.scopes[scope], id);
  }, isEqual);
};

export const useChatTopicsProjectionView = (
  surface: 'agentView' | 'sidebar',
  containerKey: string | undefined,
): ChatTopicsProjectionView | undefined => {
  useProjectionViewHydration(
    chatTopicsViewContract,
    { containerKey: containerKey ?? '', surface },
    Boolean(containerKey),
  );
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    if (!containerKey) return undefined;
    return selectChatTopicsView(state.scopes[scope], surface, containerKey);
  }, isEqual);
};
