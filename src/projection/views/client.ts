import type {
  ProjectionHydrationRequest,
  ProjectionRecord,
  ProjectionRecordHydrationRequest,
} from '@lobechat/types';

import type { ProjectionScopeState } from '../core/initialState';
import { activeProjectionRecord } from '../core/record';
import { getProjectionStoreState } from '../store';
import type { ProjectionViewContract } from './types';

const MAX_HYDRATION_PASSES = 4;
const viewHydrationInFlight = new Map<string, Promise<void>>();

const missingRecordRequest = (
  scope: ProjectionScopeState | undefined,
  request: ProjectionRecordHydrationRequest,
): ProjectionRecordHydrationRequest | undefined => {
  const table = scope?.records[request.kind] as Record<string, ProjectionRecord> | undefined;
  const ids = request.ids.filter((id) => {
    const record = table?.[id];
    if (record && !activeProjectionRecord(record)) return false;
    const fragments = record?.fragments as Record<string, unknown> | undefined;
    return request.fragments.some((fragment) => !fragments?.[fragment]);
  });
  return ids.length > 0 ? ({ ...request, ids } as ProjectionRecordHydrationRequest) : undefined;
};

const missingRequest = (
  scope: ProjectionScopeState | undefined,
  request: ProjectionHydrationRequest,
): ProjectionHydrationRequest => ({
  indexes: request.indexes?.filter((key) => !scope?.indexes[key]),
  records: request.records?.flatMap((item) => {
    const missing = missingRecordRequest(scope, item);
    return missing ? [missing] : [];
  }),
  snapshots: request.snapshots?.filter((key) => !scope?.snapshots[key]),
});

const hasHydrationWork = (request: ProjectionHydrationRequest): boolean =>
  (request.indexes?.length ?? 0) > 0 ||
  (request.records?.length ?? 0) > 0 ||
  (request.snapshots?.length ?? 0) > 0;

const requestSignature = (request: ProjectionHydrationRequest): string =>
  JSON.stringify({
    indexes: [...(request.indexes ?? [])].sort(),
    records: (request.records ?? [])
      .map(({ fragments, ids, kind }) => ({
        fragments: [...fragments].sort(),
        ids: [...ids].sort(),
        kind,
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    snapshots: [...(request.snapshots ?? [])].sort(),
  });

const ensureProjectionViewInternal = async <Params>(
  scope: string,
  contract: ProjectionViewContract<Params>,
  params: Params,
): Promise<void> => {
  const attempted = new Set<string>();

  for (let pass = 0; pass < MAX_HYDRATION_PASSES; pass += 1) {
    const projectionScope = getProjectionStoreState().scopes[scope];
    const requested = missingRequest(projectionScope, {
      indexes: pass === 0 ? contract.indexes?.(params) : undefined,
      records: contract.records?.(projectionScope, params),
      snapshots: pass === 0 ? contract.snapshots?.(params) : undefined,
    });
    if (!hasHydrationWork(requested)) return;

    const signature = requestSignature(requested);
    if (attempted.has(signature)) return;
    attempted.add(signature);
    await getProjectionStoreState().hydrateProjection(scope, requested);
  }
};

export const ensureProjectionView = async <Params>(
  scope: string,
  contract: ProjectionViewContract<Params>,
  params: Params,
): Promise<void> => {
  const key = `${scope}:${contract.key(params)}`;
  const existing = viewHydrationInFlight.get(key);
  if (existing) return existing;

  const operation = ensureProjectionViewInternal(scope, contract, params).finally(() => {
    viewHydrationInFlight.delete(key);
  });
  viewHydrationInFlight.set(key, operation);
  return operation;
};
