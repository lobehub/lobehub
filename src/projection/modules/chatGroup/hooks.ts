'use client';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { useProjectionStore } from '../../store';

type EqualityFn<T> = (left: T, right: T) => boolean;

/** Subscribe directly to the current scope's canonical ChatGroup Projection. */
export const useChatGroupProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
  equalityFn?: EqualityFn<Selected>,
): Selected => {
  const scope = useCacheScope();
  return useProjectionStore((state) => selector(state.scopes[scope]), equalityFn);
};
