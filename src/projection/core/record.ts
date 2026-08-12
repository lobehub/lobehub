import type { ProjectionFragment, ProjectionRecord } from '@lobechat/types';

export const activeProjectionRecord = <T extends ProjectionRecord>(
  record: T | undefined,
): T | undefined => {
  if (!record) return undefined;
  const tombstoneAt = record.tombstoneAt;
  if (tombstoneAt === undefined) return record;

  const fragments = Object.values(record.fragments) as Array<
    ProjectionFragment<unknown> | undefined
  >;
  return fragments.some((fragment) => fragment !== undefined && fragment.observedAt > tombstoneAt)
    ? record
    : undefined;
};
