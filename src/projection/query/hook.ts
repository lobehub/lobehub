'use client';

import type { ProjectionRequestMarker } from '@lobechat/types';
import type { Key, SWRConfiguration, SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { useCacheScope } from '@/libs/swr/useCacheScope';

import { executeProjectionRequest, type ProjectionQueryDefinition } from './runtime';

interface ProjectionRequestOptions extends SWRConfiguration<ProjectionRequestMarker> {
  scope?: string;
}

export type ProjectionQueryResponse<Data> = Omit<SWRResponse<ProjectionRequestMarker>, 'data'> & {
  data: Data | undefined;
};

/** SWR schedules the request; the Query Runtime owns request-to-Projection orchestration. */
export const useProjectionRequest = <Params, Response>(
  key: Key,
  definition: ProjectionQueryDefinition<Params, Response>,
  params: Params,
  options?: ProjectionRequestOptions,
): SWRResponse<ProjectionRequestMarker> => {
  const activeScope = useCacheScope();
  const { scope = activeScope, ...swrOptions } = options ?? {};

  return useClientDataSWR<ProjectionRequestMarker>(
    key,
    () => executeProjectionRequest(definition, params, scope),
    swrOptions,
  );
};
