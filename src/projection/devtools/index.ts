import type {
  ProjectionFragment,
  ProjectionIndex,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import { isAgentIndex } from '../modules/agent/validators';
import { isBriefIndex } from '../modules/brief/validators';
import { isChatIndex } from '../modules/chat/validators';
import { isChatGroupIndex } from '../modules/chatGroup/validators';
import { isHomeIndex, isHomeSnapshot } from '../modules/home/validators';
import { isTaskIndex } from '../modules/task/validators';
import { getProjectionStoreState } from '../store';
import {
  createProjectionFragmentEditRecord,
  getManagedProjectionFragment,
  type ManagedProjection,
} from './managedProjection';

interface ProjectionDevtoolValueEditTarget {
  fieldName: string;
  key: string;
  path?: ProjectionDevtoolValuePath;
  scope: string;
  type: 'index' | 'snapshot';
}

interface ProjectionDevtoolFragmentEditTarget {
  fragmentName: string;
  path?: ProjectionDevtoolValuePath;
  projection: ManagedProjection;
  type: 'fragment';
}

export type ProjectionDevtoolValuePath = readonly (number | string)[];

export type ProjectionDevtoolEditTarget =
  ProjectionDevtoolFragmentEditTarget | ProjectionDevtoolValueEditTarget;

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

const getFragmentData = (
  projection: ManagedProjection,
  fragmentName: string,
): Record<string, unknown> => {
  const liveProjection = getLiveProjection(projection);
  const fragment = getManagedProjectionFragment(
    liveProjection ? { ...projection, record: liveProjection } : projection,
    fragmentName,
  );
  if (!fragment) {
    throw new Error(`Fragment “${fragmentName}” is no longer available on this Projection.`);
  }
  return fragment.data;
};

const nextObservation = (values: Array<number | undefined>): number =>
  Math.max(Date.now(), ...values.map((value) => (value === undefined ? 0 : value + 1)));

const IMMUTABLE_VALUE_FIELDS = new Set(['key', 'observedAt', 'source']);

const replaceProjectionValueAtPath = (
  currentValue: unknown,
  path: ProjectionDevtoolValuePath,
  value: unknown,
): unknown => {
  const [segment, ...remainingPath] = path;
  if (segment === undefined) return value;

  if (typeof segment === 'number') {
    if (!Array.isArray(currentValue) || !Object.hasOwn(currentValue, segment)) {
      throw new Error(`Array item at index ${segment} is no longer available.`);
    }

    const nextValue = [...currentValue];
    nextValue[segment] = replaceProjectionValueAtPath(currentValue[segment], remainingPath, value);
    return nextValue;
  }

  if (!isPlainRecord(currentValue) || !Object.hasOwn(currentValue, segment)) {
    throw new Error(`Object property “${segment}” is no longer available.`);
  }

  return {
    ...currentValue,
    [segment]: replaceProjectionValueAtPath(currentValue[segment], remainingPath, value),
  };
};

const reviveSidebarDates = (value: unknown, propertyName?: string): unknown => {
  if (propertyName === 'updatedAt' && typeof value === 'string') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  if (Array.isArray(value)) return value.map((item) => reviveSidebarDates(item));
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, reviveSidebarDates(item, key)]),
  );
};

const getLiveProjectionValue = (
  target: ProjectionDevtoolValueEditTarget,
): ProjectionIndex | ProjectionSnapshot => {
  const scope = getProjectionStoreState().scopes[target.scope];
  if (!scope) throw new Error(`Projection scope “${target.scope}” is no longer available.`);

  const values = (target.type === 'index' ? scope.indexes : scope.snapshots) as Record<
    string,
    ProjectionIndex | ProjectionSnapshot | undefined
  >;
  const current = values[target.key];
  if (!current) {
    throw new Error(`Projection ${target.type} “${target.key}” is no longer available.`);
  }
  return current;
};

export const serializeProjectionCellDraft = (value: unknown, pretty = false): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();

  try {
    const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
    if (serialized === undefined) throw new Error('The value cannot be represented as JSON.');
    return serialized;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The cell cannot be represented as JSON: ${message}`, { cause: error });
  }
};

export const parseProjectionCellDraft = (draft: string, currentValue: unknown): unknown => {
  if (typeof currentValue === 'string') return draft;
  if (currentValue instanceof Date) {
    const date = new Date(draft);
    if (!Number.isFinite(date.getTime())) throw new Error('Cell value must be a valid date.');
    return date;
  }

  try {
    return JSON.parse(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cell value must be valid JSON: ${message}`, { cause: error });
  }
};

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

const applyProjectionValueEdit = async ({
  target,
  value,
}: {
  target: ProjectionDevtoolValueEditTarget;
  value: unknown;
}): Promise<ProjectionIndex | ProjectionSnapshot> => {
  if (IMMUTABLE_VALUE_FIELDS.has(target.fieldName)) {
    throw new Error(`Projection field “${target.fieldName}” is immutable.`);
  }

  const current = getLiveProjectionValue(target);
  if (!Object.hasOwn(current, target.fieldName)) {
    throw new Error(`Field “${target.fieldName}” is no longer available on this Projection.`);
  }

  const currentValue = (current as unknown as Record<string, unknown>)[target.fieldName];
  const nextValue = target.path
    ? replaceProjectionValueAtPath(currentValue, target.path, value)
    : value;
  const editedValue =
    target.type === 'index' && current.key === 'home.sidebar'
      ? reviveSidebarDates(nextValue)
      : nextValue;
  const candidate: unknown = {
    ...current,
    [target.fieldName]: editedValue,
    observedAt: nextObservation([current.observedAt]),
    source: 'mutation',
  };

  if (target.type === 'index') {
    if (
      !isAgentIndex(candidate) &&
      !isBriefIndex(candidate) &&
      !isChatGroupIndex(candidate) &&
      !isChatIndex(candidate) &&
      !isHomeIndex(candidate) &&
      !isTaskIndex(candidate)
    ) {
      throw new Error(`The edited field does not match the schema for index “${target.key}”.`);
    }
    await getProjectionStoreState().internal_commitProjectionForDevtools(target.scope, {
      indexes: [candidate],
    });
    return candidate;
  }

  if (!isHomeSnapshot(candidate)) {
    throw new Error(`The edited field does not match the schema for snapshot “${target.key}”.`);
  }
  await getProjectionStoreState().internal_commitProjectionForDevtools(target.scope, {
    snapshots: [candidate],
  });
  return candidate;
};

export const applyProjectionCellEdit = async ({
  target,
  value,
}: {
  target: ProjectionDevtoolEditTarget;
  value: unknown;
}): Promise<ProjectionIndex | ProjectionRecord | ProjectionSnapshot> => {
  if (target.type !== 'fragment') return applyProjectionValueEdit({ target, value });
  const data = target.path
    ? replaceProjectionValueAtPath(
        getFragmentData(target.projection, target.fragmentName),
        target.path,
        value,
      )
    : value;
  if (!isPlainRecord(data)) throw new Error('Fragment data must be a JSON object.');

  return applyProjectionFragmentEdit({
    data,
    fragmentName: target.fragmentName,
    projection: target.projection,
  });
};

export type { ManagedProjection, ManagedProjectionInspection } from './managedProjection';
export {
  getManagedProjectionFragment,
  getManagedProjectionFragmentNames,
  inspectManagedProjection,
  parseProjectionFragmentDraft,
  serializeProjectionFragment,
} from './managedProjection';
