import { getCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { getProjectionStoreState } from '../../store';
import { type AgentProjectionView, selectAgentProjectionById } from './selectors';

/** Read an Agent Projection selection outside React. */
export const getAgentProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
): Selected => selector(getProjectionStoreState().scopes[getCacheScope()]);

export const getAgentProjectionById = (id: string | undefined): AgentProjectionView | undefined =>
  getAgentProjection((scope) => selectAgentProjectionById(scope, id));
