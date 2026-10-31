import { describe, expect, it, vi } from 'vitest';

import {
  cacheScope,
  type ReplicaScopeSource,
  replicaSWRDriver,
  setReplicaScopeSource,
} from './index';

// Many suites mock `@/libs/swr` with only the exports they use. The topic store
// imports this module eagerly, so it must not touch `mutate` at import time.
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));

describe('@/libs/replica', () => {
  const source: ReplicaScopeSource = {
    canHydrate: () => false,
    canPersist: () => false,
    get: () => 'u1:workbench',
    use: () => 'u1:workbench',
  };

  it('imports under a partial `@/libs/swr` mock', () => {
    expect(replicaSWRDriver).toBeDefined();
  });

  it('lets a runtime without the user store install its own scope source', () => {
    expect(cacheScope.canHydrate?.()).toBe(true);

    // The Workbench runtime installs one at boot (it never mounts the user
    // store), so its replicas follow its own identity check instead.
    setReplicaScopeSource(source);
    expect(cacheScope.canHydrate?.()).toBe(false);
    expect(cacheScope.canPersist()).toBe(false);
    expect(cacheScope.get()).toBe('u1:workbench');
  });
});
