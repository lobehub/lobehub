'use client';

import type { ProjectionRequestMarker } from '@lobechat/types';
import type { SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { projectionKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';

import { nextProjectionObservedAt } from '../core/ingest';
import { ensureProjectionView } from './client';
import type { ProjectionViewContract } from './types';

export const useProjectionViewHydration = <Params>(
  contract: ProjectionViewContract<Params>,
  params: Params,
  enabled = true,
  scopeOverride?: string,
): SWRResponse<ProjectionRequestMarker> => {
  const scope = scopeOverride ?? getCacheScope();
  return useClientDataSWR<ProjectionRequestMarker>(
    enabled ? projectionKeys.localView(scope, contract.key(params)) : null,
    async () => {
      await ensureProjectionView(scope, contract, params);
      return { observedAt: nextProjectionObservedAt() };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
};
