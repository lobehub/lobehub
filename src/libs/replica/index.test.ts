import { describe, expect, it, vi } from 'vitest';

import { replicaSWRDriver } from './index';

// Many suites mock `@/libs/swr` with only the exports they use. The topic store
// imports this module eagerly, so it must not touch `mutate` at import time.
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));

describe('@/libs/replica', () => {
  it('imports under a partial `@/libs/swr` mock', () => {
    expect(replicaSWRDriver).toBeDefined();
  });
});
