import type { ProjectionFragment, ProjectionRecord } from '@lobechat/types';

import { getProjectionStoreState } from '../store';
import {
  createProjectionFragmentEditRecord,
  getManagedProjectionFragment,
  type ManagedProjection,
} from './managedProjection';

const getLiveProjection = (projection: ManagedProjection): ProjectionRecord | undefined => {
  const scope = getProjectionStoreState().scopes[projection.scope];
  if (!scope) return undefined;

  const table = scope.records[projection.record.kind] as Record<
    string,
    ProjectionRecord | undefined
  >;
  return table[projection.record.id];
};

const getFragmentObservation = (
  record: ProjectionRecord | undefined,
  fragmentName: string,
): number | undefined => {
  if (!record) return undefined;
  const fragments = record.fragments as Record<
    string,
    ProjectionFragment<Record<string, unknown>> | undefined
  >;
  return fragments[fragmentName]?.observedAt;
};

const nextObservation = (values: Array<number | undefined>): number =>
  Math.max(Date.now(), ...values.map((value) => (value === undefined ? 0 : value + 1)));

export const applyProjectionFragmentEdit = async ({
  data,
  projection,
  fragmentName,
}: {
  data: Record<string, unknown>;
  projection: ManagedProjection;
  fragmentName: string;
}): Promise<ProjectionRecord> => {
  const liveProjection = getLiveProjection(projection);
  const observedAt = nextObservation([
    getManagedProjectionFragment(projection, fragmentName)?.observedAt,
    projection.record.tombstoneAt,
    getFragmentObservation(liveProjection, fragmentName),
    liveProjection?.tombstoneAt,
  ]);
  const editedRecord = createProjectionFragmentEditRecord({
    data,
    projection,
    fragmentName,
    observedAt,
  });

  await getProjectionStoreState().internal_commitProjectionForDevtools(projection.scope, {
    records: [editedRecord],
  });
  return editedRecord;
};

export type { ManagedProjection, ManagedProjectionInspection } from './managedProjection';
export {
  getManagedProjectionFragment,
  getManagedProjectionFragmentNames,
  inspectManagedProjection,
  parseProjectionFragmentDraft,
  serializeProjectionFragment,
} from './managedProjection';
