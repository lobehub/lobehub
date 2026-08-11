import type {
  DesktopProjectionCommit,
  DesktopProjectionFragment,
  DesktopProjectionHydration,
  DesktopProjectionIndex,
  DesktopProjectionRecord,
  DesktopProjectionSnapshot,
} from '@lobechat/electron-client-ipc';
import type {
  ProjectionFragment,
  ProjectionIndex,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@lobechat/types';
import superjson from 'superjson';

import { isAgentIndex } from '../modules/agent/validators';
import { isBriefIndex } from '../modules/brief/validators';
import { isChatIndex } from '../modules/chat/validators';
import { isChatGroupIndex } from '../modules/chatGroup/validators';
import { isHomeIndex, isHomeSnapshot } from '../modules/home/validators';
import { isTaskIndex } from '../modules/task/validators';
import { isProjectionRecord } from '../records/validators';
import type { HydratedProjection, MaterializedProjectionCommit } from './types';

const encodeFragment = (fragment: ProjectionFragment<unknown>): DesktopProjectionFragment => ({
  data: superjson.stringify(fragment.data),
  observedAt: fragment.observedAt,
  source: fragment.source,
});

const encodeRecord = (record: ProjectionRecord): DesktopProjectionRecord => ({
  fragments: Object.fromEntries(
    Object.entries(record.fragments as Record<string, ProjectionFragment<unknown>>).map(
      ([name, fragment]) => [name, encodeFragment(fragment)],
    ),
  ),
  id: record.id,
  kind: record.kind,
  ...(record.tombstoneAt === undefined ? {} : { tombstoneAt: record.tombstoneAt }),
});

const encodeIndex = (index: ProjectionIndex): DesktopProjectionIndex => {
  const { key, observedAt, source, ...data } = index;
  return { data: superjson.stringify(data), key, observedAt, source };
};

const encodeSnapshot = (snapshot: ProjectionSnapshot): DesktopProjectionSnapshot => ({
  data: superjson.stringify(snapshot.data),
  key: snapshot.key,
  observedAt: snapshot.observedAt,
  source: snapshot.source,
});

export const encodeProjectionCommit = (
  scope: string,
  commit: MaterializedProjectionCommit,
): DesktopProjectionCommit => ({
  indexes: commit.indexes.map(encodeIndex),
  records: commit.records.map(encodeRecord),
  scope,
  snapshots: commit.snapshots.map(encodeSnapshot),
});

const decodeRecord = (record: DesktopProjectionRecord): ProjectionRecord | undefined => {
  try {
    const fragments = Object.fromEntries(
      Object.entries(record.fragments).map(([name, fragment]) => [
        name,
        {
          data: superjson.parse(fragment.data),
          observedAt: fragment.observedAt,
          source: fragment.source,
        },
      ]),
    );
    const candidate: unknown = {
      fragments,
      id: record.id,
      kind: record.kind,
      ...(record.tombstoneAt === undefined ? {} : { tombstoneAt: record.tombstoneAt }),
    };
    return isProjectionRecord(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const decodeIndex = (index: DesktopProjectionIndex): ProjectionIndex | undefined => {
  try {
    const candidate: unknown = {
      ...superjson.parse<Record<string, unknown>>(index.data),
      key: index.key,
      observedAt: index.observedAt,
      source: index.source,
    };
    return isAgentIndex(candidate) ||
      isBriefIndex(candidate) ||
      isChatGroupIndex(candidate) ||
      isChatIndex(candidate) ||
      isHomeIndex(candidate) ||
      isTaskIndex(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
};

const decodeSnapshot = (snapshot: DesktopProjectionSnapshot): ProjectionSnapshot | undefined => {
  try {
    const candidate: unknown = {
      data: superjson.parse(snapshot.data),
      key: snapshot.key,
      observedAt: snapshot.observedAt,
      source: snapshot.source,
    };
    return isHomeSnapshot(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
};

export const decodeProjectionHydration = (
  hydration: DesktopProjectionHydration,
): HydratedProjection => ({
  indexes: hydration.indexes
    .map(decodeIndex)
    .filter((index): index is ProjectionIndex => index !== undefined),
  records: hydration.records
    .map(decodeRecord)
    .filter((record): record is ProjectionRecord => record !== undefined),
  snapshots: hydration.snapshots
    .map(decodeSnapshot)
    .filter((snapshot): snapshot is ProjectionSnapshot => snapshot !== undefined),
});
