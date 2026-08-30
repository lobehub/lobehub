import type { ProjectionSource } from './base';

export const PROJECTION_SOURCES = [
  'mutation',
  'network',
  'realtime',
] as const satisfies readonly ProjectionSource[];

const PROJECTION_SOURCE_PRIORITY: Record<ProjectionSource, number> = {
  mutation: 3,
  network: 1,
  realtime: 2,
};

export interface ProjectionObservation {
  observedAt: number;
  source: ProjectionSource;
}

export const isProjectionSource = (value: unknown): value is ProjectionSource =>
  typeof value === 'string' && (PROJECTION_SOURCES as readonly string[]).includes(value);

export const isProjectionTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const shouldReplaceProjectionObservation = (
  current: ProjectionObservation | undefined,
  incoming: ProjectionObservation,
): boolean =>
  !current ||
  incoming.observedAt > current.observedAt ||
  (incoming.observedAt === current.observedAt &&
    PROJECTION_SOURCE_PRIORITY[incoming.source] >= PROJECTION_SOURCE_PRIORITY[current.source]);

interface ProjectionRecordLike {
  fragments: object;
  id: string;
  kind: string;
  tombstoneAt?: number;
}

export const mergeProjectionRecord = <RecordType extends ProjectionRecordLike>(
  current: RecordType | undefined,
  incoming: RecordType,
): RecordType => {
  const tombstoneAt =
    current?.tombstoneAt === undefined
      ? incoming.tombstoneAt
      : incoming.tombstoneAt === undefined
        ? current.tombstoneAt
        : Math.max(current.tombstoneAt, incoming.tombstoneAt);
  const fragments = Object.fromEntries(
    Object.entries(current?.fragments ?? {}).filter(
      ([, fragment]) =>
        tombstoneAt === undefined || (fragment as ProjectionObservation).observedAt > tombstoneAt,
    ),
  ) as Record<string, ProjectionObservation>;

  for (const [name, candidate] of Object.entries(incoming.fragments) as Array<
    [string, ProjectionObservation]
  >) {
    if (tombstoneAt !== undefined && candidate.observedAt <= tombstoneAt) continue;
    if (!shouldReplaceProjectionObservation(fragments[name], candidate)) continue;
    fragments[name] = candidate;
  }

  return {
    fragments,
    id: incoming.id,
    kind: incoming.kind,
    ...(tombstoneAt === undefined ? {} : { tombstoneAt }),
  } as RecordType;
};
