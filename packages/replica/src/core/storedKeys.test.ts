import { describe, expect, it } from 'vitest';

import { staticReplicaScope } from './defineReplica';
import { REPLICA_INDEX_KEY } from './engine';
import { readReplicaStoredKeys } from './storedKeys';
import type { ReplicaRow, ReplicaStorage } from './types';

const memoryStorage = (rows: Record<string, ReplicaRow<any>>): ReplicaStorage<any> => ({
  get: async ({ queryKey, scope }) => rows[`${scope}/${queryKey}`],
  remove: async () => {},
  set: async () => {},
});

describe('readReplicaStoredKeys', () => {
  it('reads the index row of the active scope', async () => {
    const storage = memoryStorage({
      [`a/${REPLICA_INDEX_KEY}`]: { data: ['k1', 'k2?sort=asc'], updatedAt: 1 },
      [`b/${REPLICA_INDEX_KEY}`]: { data: ['other'], updatedAt: 1 },
    });

    await expect(readReplicaStoredKeys({ scope: staticReplicaScope('a'), storage })).resolves.toEqual(
      ['k1', 'k2?sort=asc'],
    );
  });

  it('reports no keys without an index row or a storage', async () => {
    const scope = staticReplicaScope('a');

    await expect(readReplicaStoredKeys({ scope, storage: memoryStorage({}) })).resolves.toEqual([]);
    await expect(readReplicaStoredKeys({ scope, storage: undefined })).resolves.toEqual([]);
  });
});
