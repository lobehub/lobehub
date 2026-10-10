import { afterEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, replicaSWRDriver, setReplicaPersistedHydration } from './index';

// Many suites mock `@/libs/swr` with only the exports they use. The topic store
// imports this module eagerly, so it must not touch `mutate` at import time.
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));

describe('@/libs/replica', () => {
  afterEach(() => setReplicaPersistedHydration(true));

  it('imports under a partial `@/libs/swr` mock', () => {
    expect(replicaSWRDriver).toBeDefined();
  });

  it('lets an identity-less runtime opt out of persisted hydration', () => {
    expect(cacheScope.canHydrate?.()).toBe(true);

    // The Workbench runtime turns this off at boot (it never mounts the user
    // store), so its replicas read network-only instead of a guessed partition.
    setReplicaPersistedHydration(false);
    expect(cacheScope.canHydrate?.()).toBe(false);
  });
});
