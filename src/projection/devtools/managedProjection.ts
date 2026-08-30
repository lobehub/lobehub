import type { ProjectionFragment, ProjectionRecord } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import type { LocalDatabaseEntry } from '@/libs/localDatabase';

import { isProjectionRecord } from '../records/validators';

const PROJECTION_CACHE_SCHEMA_VERSION = 1;

export interface ManagedProjection {
  entryKey: string;
  record: ProjectionRecord;
  scope: string;
}

export type ManagedProjectionInspection =
  { projection: ManagedProjection; status: 'editable' } | { reason: string; status: 'invalid' };

type ManagedFragment = ProjectionFragment<Record<string, unknown>>;

const getFragments = (record: ProjectionRecord): Record<string, ManagedFragment | undefined> =>
  record.fragments as Record<string, ManagedFragment | undefined>;

export const inspectManagedProjection = (
  entry: LocalDatabaseEntry,
): ManagedProjectionInspection => {
  if (!isPlainRecord(entry.value)) {
    return { reason: 'The stored value is not a Projection envelope.', status: 'invalid' };
  }
  if (entry.value.schemaVersion !== PROJECTION_CACHE_SCHEMA_VERSION) {
    return {
      reason: `Only Projection cache schema version ${PROJECTION_CACHE_SCHEMA_VERSION} can be edited.`,
      status: 'invalid',
    };
  }
  if (typeof entry.value.scope !== 'string' || !entry.value.scope) {
    return { reason: 'The Projection cache row has no valid scope.', status: 'invalid' };
  }
  if (!isProjectionRecord(entry.value.value)) {
    return {
      reason: 'The stored record does not match the Projection registry.',
      status: 'invalid',
    };
  }

  const record = entry.value.value;
  if (Object.keys(record.fragments).length === 0) {
    return { reason: 'This Projection has no editable fragments.', status: 'invalid' };
  }

  return {
    projection: { entryKey: entry.key, record, scope: entry.value.scope },
    status: 'editable',
  };
};

export const getManagedProjectionFragmentNames = (projection: ManagedProjection): string[] =>
  Object.keys(projection.record.fragments).sort((a, b) => a.localeCompare(b));

export const getManagedProjectionFragment = (
  projection: ManagedProjection,
  fragmentName: string,
): ManagedFragment | undefined => getFragments(projection.record)[fragmentName];

export const serializeProjectionFragment = (data: Record<string, unknown>): string => {
  try {
    const serialized = JSON.stringify(data, null, 2);
    if (serialized === undefined) throw new Error('The fragment cannot be represented as JSON.');
    return serialized;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The fragment cannot be represented as JSON: ${message}`, { cause: error });
  }
};

export const parseProjectionFragmentDraft = (draft: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fragment data must be valid JSON: ${message}`, { cause: error });
  }

  if (!isPlainRecord(parsed)) throw new Error('Fragment data must be a JSON object.');
  return parsed as Record<string, unknown>;
};

export const createProjectionFragmentEditRecord = ({
  data,
  projection,
  fragmentName,
  observedAt,
}: {
  data: Record<string, unknown>;
  projection: ManagedProjection;
  fragmentName: string;
  observedAt: number;
}): ProjectionRecord => {
  if (!getManagedProjectionFragment(projection, fragmentName)) {
    throw new Error(`Fragment “${fragmentName}” does not exist on this Projection.`);
  }

  const candidate: unknown = {
    fragments: {
      [fragmentName]: { data, observedAt, source: 'mutation' },
    },
    id: projection.record.id,
    kind: projection.record.kind,
  };

  if (!isProjectionRecord(candidate)) {
    throw new Error('The edited fragment does not match the Projection registry.');
  }
  return candidate;
};
