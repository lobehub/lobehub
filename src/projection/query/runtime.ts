import type { ProjectionRequestMarker } from '@lobechat/types';

import { nextProjectionObservedAt } from '../core/ingest';

export interface ProjectionQueryContext<Params> {
  observedAt: number;
  params: Params;
  scope: string;
}

export interface ProjectionQueryDefinition<Params, Response> {
  project: (response: Response, context: ProjectionQueryContext<Params>) => Promise<void> | void;
  query: (params: Params, context: ProjectionQueryContext<Params>) => Promise<Response>;
}

export interface ProjectionQueryExecution<Response> {
  marker: ProjectionRequestMarker;
  response: Response;
}

export const defineProjectionQuery = <Params, Response>(
  definition: ProjectionQueryDefinition<Params, Response>,
): ProjectionQueryDefinition<Params, Response> => definition;

/**
 * Execute one Projection query as a single request-to-commit transaction.
 *
 * The observation is recorded before the network request starts. The same
 * marker is then passed to the domain projector, allowing the Projection
 * reducer to reject an older response that settles after a newer request.
 */
export const executeProjectionQuery = async <Params, Response>(
  definition: ProjectionQueryDefinition<Params, Response>,
  params: Params,
  scope: string,
): Promise<ProjectionQueryExecution<Response>> => {
  const observedAt = nextProjectionObservedAt();
  const context = { observedAt, params, scope };
  const response = await definition.query(params, context);
  await definition.project(response, context);

  return { marker: { observedAt }, response };
};

/** Projection-native SWR fetchers retain only request lifecycle metadata. */
export const executeProjectionRequest = async <Params, Response>(
  definition: ProjectionQueryDefinition<Params, Response>,
  params: Params,
  scope: string,
): Promise<ProjectionRequestMarker> => {
  const { marker } = await executeProjectionQuery(definition, params, scope);
  return marker;
};
