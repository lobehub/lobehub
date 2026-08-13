import { getCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { getProjectionStoreState } from '../../store';

/** Read a ChatGroup Projection selection outside React. */
export const getChatGroupProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
): Selected => {
  const scope = getCacheScope();
  return selector(getProjectionStoreState().scopes[scope]);
};
