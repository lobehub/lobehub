import type { ProjectionFragment, ProjectionRecord, ProjectionSource } from '@lobechat/types';

import type { ProjectionScopeState, ProjectionStoreState } from '@/projection/core/initialState';
import type { ManagedProjection } from '@/projection/devtools';
import { projectionStorageKeys } from '@/projection/persistence/repository';

export interface ProjectionScopeRow {
  hydrationStatus: ProjectionScopeState['hydrationStatus'];
  recordCount: number;
  scope: string;
}

export interface ProjectionTableRow {
  fragmentNames: string[];
  latestObservedAt?: number;
  projection: ManagedProjection;
  sources: ProjectionSource[];
}

const getRecordCount = (scope: ProjectionScopeState): number =>
  Object.values(scope.records).reduce((count, records) => count + Object.keys(records).length, 0);

const getFragments = (record: ProjectionRecord): ProjectionFragment<unknown>[] =>
  Object.values(record.fragments as Record<string, ProjectionFragment<unknown> | undefined>).filter(
    (fragment): fragment is ProjectionFragment<unknown> => Boolean(fragment),
  );

const serializeForSearch = (record: ProjectionRecord): string => {
  try {
    return JSON.stringify(record.fragments);
  } catch {
    return '';
  }
};

export const createProjectionScopeRows = (
  scopes: ProjectionStoreState['scopes'],
): ProjectionScopeRow[] =>
  Object.entries(scopes)
    .map(([scope, state]) => ({
      hydrationStatus: state.hydrationStatus,
      recordCount: getRecordCount(state),
      scope,
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope));

export const filterProjectionScopeRows = (
  rows: ProjectionScopeRow[],
  search: string,
): ProjectionScopeRow[] => {
  const term = search.trim().toLowerCase();
  if (!term) return rows;

  return rows.filter(
    ({ hydrationStatus, scope }) =>
      scope.toLowerCase().includes(term) || hydrationStatus.toLowerCase().includes(term),
  );
};

export const createProjectionTableRows = (
  scope: string,
  state: ProjectionScopeState | undefined,
): ProjectionTableRow[] => {
  if (!state) return [];

  const rows: ProjectionTableRow[] = [];
  for (const records of Object.values(state.records)) {
    for (const record of Object.values(records) as ProjectionRecord[]) {
      const fragments = getFragments(record);
      const observations = [
        ...fragments.map(({ observedAt }) => observedAt),
        ...(record.tombstoneAt === undefined ? [] : [record.tombstoneAt]),
      ];

      rows.push({
        fragmentNames: Object.keys(record.fragments).sort((a, b) => a.localeCompare(b)),
        latestObservedAt: observations.length > 0 ? Math.max(...observations) : undefined,
        projection: {
          entryKey: projectionStorageKeys.record(scope, record.kind, record.id),
          record,
          scope,
        },
        sources: [...new Set(fragments.map(({ source }) => source))].sort((a, b) =>
          a.localeCompare(b),
        ),
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.projection.record.kind.localeCompare(b.projection.record.kind) ||
      a.projection.record.id.localeCompare(b.projection.record.id),
  );
};

export const filterProjectionTableRows = (
  rows: ProjectionTableRow[],
  search: string,
): ProjectionTableRow[] => {
  const term = search.trim().toLowerCase();
  if (!term) return rows;

  return rows.filter(({ fragmentNames, projection, sources }) => {
    const { record, scope } = projection;
    return [scope, record.kind, record.id, ...fragmentNames, ...sources, serializeForSearch(record)]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
};
