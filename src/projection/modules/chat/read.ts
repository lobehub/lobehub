import { getCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { getProjectionStoreState } from '../../store';

/** Read a Chat Projection selection outside React. */
export const getChatProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
): Selected => selector(getProjectionStoreState().scopes[getCacheScope()]);
