import { defineReplica } from '@/libs/replica';
import type { TfsData, TfsQuery } from '@/services/tfs';

export const tfsQueryKey = (p: TfsQuery) =>
  JSON.stringify([
    p.kind,
    p.binding,
    p.project,
    p.repository,
    p.resource,
    p.id,
    p.cursor,
    p.path,
    p.version,
    p.logId,
    p.startLine,
  ]);

/** Personal TFS data is memory-only, partitioned by the replica's verified user scope. */
export const tfsResource = defineReplica<TfsQuery, TfsData>({
  key: tfsQueryKey,
  name: 'tfs',
  storage: 'memory',
  version: 1,
});
