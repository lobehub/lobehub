import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import {
  extractAffectedPaths,
  hasPathConflict,
  OptimisticEngine,
  type OptimisticMutationSnapshot,
} from './optimisticEngine';

interface TestState {
  count: number;
  nested: {
    value: number;
  };
  other: number;
}

const createTestStore = (initialState: TestState) => createStore<TestState>()(() => initialState);

const createDeferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((res, rej) => {
    reject = rej;
    resolve = res;
  });

  return { promise, reject, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('optimisticEngine helpers', () => {
  it('should extract affected paths from immer patches', () => {
    expect(
      extractAffectedPaths([
        { op: 'replace', path: ['nested', 'value'], value: 1 },
        { op: 'replace', path: ['count'], value: 1 },
      ]),
    ).toEqual(['nested.value', 'count']);
  });

  it('should detect conflicting and non-conflicting paths', () => {
    expect(hasPathConflict(['store:count'], ['store:count.value'])).toBe(true);
    expect(hasPathConflict(['store:count'], ['store:other'])).toBe(false);
  });
});

describe('OptimisticEngine', () => {
  it('should keep optimistic patches after a successful mutation', async () => {
    const snapshots: OptimisticMutationSnapshot[][] = [];
    const onSuccess = vi.fn();
    const transactionOnSuccess = vi.fn();
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store, {
      onMutationSuccess: onSuccess,
      onQueueChange: (nextSnapshots) => {
        snapshots.push(nextSnapshots);
      },
    });
    const tx = engine.createTransaction('increment');

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.onSuccess = transactionOnSuccess;
    tx.mutation = async () => 'ok';

    await expect(tx.commit<string>()).resolves.toBe('ok');
    expect(store.getState().count).toBe(1);
    expect(transactionOnSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.[0]?.status).toBe('success');
  });

  it('should retry a mutation before succeeding', async () => {
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store, { maxRetries: 1 });
    const tx = engine.createTransaction('increment');
    let attempts = 0;

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.mutation = async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new Error('retry');
      }

      return 'retried';
    };

    await expect(tx.commit<string>()).resolves.toBe('retried');
    expect(attempts).toBe(2);
    expect(store.getState().count).toBe(1);
  });

  it('should rollback optimistic patches when the mutation fails', async () => {
    const onError = vi.fn();
    const transactionOnError = vi.fn();
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store, { onMutationError: onError });
    const tx = engine.createTransaction('increment');

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.onError = transactionOnError;
    tx.mutation = async () => {
      throw new Error('mutation failed');
    };

    await expect(tx.commit()).rejects.toThrow('mutation failed');
    expect(store.getState().count).toBe(0);
    expect(transactionOnError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should serialize conflicting mutations on the same path', async () => {
    const deferred = createDeferred<string>();
    const calls: string[] = [];
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store);

    const tx1 = engine.createTransaction('first');
    tx1.set((draft) => {
      draft.count += 1;
    });
    tx1.mutation = async () => {
      calls.push('first-start');
      const result = await deferred.promise;
      calls.push('first-end');

      return result;
    };

    const tx2 = engine.createTransaction('second');
    tx2.set((draft) => {
      draft.count += 1;
    });
    tx2.mutation = async () => {
      calls.push('second-start');
      return 'second';
    };

    const firstPromise = tx1.commit<string>();
    const secondPromise = tx2.commit<string>();

    await Promise.resolve();
    expect(calls).toEqual(['first-start']);

    deferred.resolve('first');

    await expect(firstPromise).resolves.toBe('first');
    await expect(secondPromise).resolves.toBe('second');
    expect(calls).toEqual(['first-start', 'first-end', 'second-start']);
    expect(store.getState().count).toBe(2);
  });

  it('should rollback the failed mutation and rebase other inflight mutations', async () => {
    const deferred = createDeferred<string>();
    const errors: unknown[] = [];
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store, {
      onMutationError: (snapshot, error) => {
        errors.push({ error, snapshot });
      },
    });

    const tx1 = engine.createTransaction('delayed');
    tx1.set((draft) => {
      draft.count += 1;
    });
    tx1.mutation = async () => deferred.promise;

    const tx2 = engine.createTransaction('fail');
    tx2.set((draft) => {
      draft.other += 1;
    });
    tx2.mutation = async () => {
      throw new Error('boom');
    };

    const tx1Promise = tx1.commit<string>();
    await expect(tx2.commit()).rejects.toThrow('boom');
    expect(store.getState()).toEqual({ count: 1, nested: { value: 0 }, other: 0 });

    deferred.resolve('late-success');

    await expect(tx1Promise).resolves.toBe('late-success');
    expect(store.getState()).toEqual({ count: 1, nested: { value: 0 }, other: 0 });
    expect(errors).toHaveLength(1);
  });

  it('should wait in flush until pending work is finished', async () => {
    const deferred = createDeferred<string>();
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store);
    const tx = engine.createTransaction('increment');

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.mutation = async () => deferred.promise;

    const commitPromise = tx.commit<string>();
    let flushed = false;
    const flushPromise = engine.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    deferred.resolve('done');

    await commitPromise;
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it('should resolve flush immediately when the queue is idle', async () => {
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store);

    await expect(engine.flush()).resolves.toBeUndefined();
  });

  it('should support external stores and deferred flush', async () => {
    const defaultStore = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const externalStore = createTestStore({ count: 10, nested: { value: 1 }, other: 20 });
    const engine = new OptimisticEngine(defaultStore);
    const tx = engine.createTransaction('multi-store');

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.set(
      externalStore,
      (draft) => {
        draft.other += 1;
      },
      { flush: false },
    );
    tx.mutation = async () => 'done';

    expect(externalStore.getState().other).toBe(20);
    await expect(tx.commit<string>()).resolves.toBe('done');
    expect(defaultStore.getState().count).toBe(1);
    expect(externalStore.getState().other).toBe(21);
  });

  it('should rebase rollback correctly across different stores', async () => {
    const deferred = createDeferred<string>();
    const defaultStore = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const externalStore = createTestStore({ count: 10, nested: { value: 1 }, other: 20 });
    const engine = new OptimisticEngine(defaultStore);

    const tx1 = engine.createTransaction('external');
    tx1.set(externalStore, (draft) => {
      draft.other += 1;
    });
    tx1.mutation = async () => deferred.promise;

    const tx2 = engine.createTransaction('default-fail');
    tx2.set((draft) => {
      draft.count += 1;
    });
    tx2.mutation = async () => {
      throw new Error('boom');
    };

    const tx1Promise = tx1.commit<string>();
    await expect(tx2.commit()).rejects.toThrow('boom');

    expect(defaultStore.getState()).toEqual({ count: 0, nested: { value: 0 }, other: 0 });
    expect(externalStore.getState()).toEqual({ count: 10, nested: { value: 1 }, other: 21 });

    deferred.resolve('external');

    await expect(tx1Promise).resolves.toBe('external');
  });

  it('should support external stores without explicitly passing options', async () => {
    const defaultStore = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const externalStore = createTestStore({ count: 10, nested: { value: 1 }, other: 20 });
    const engine = new OptimisticEngine(defaultStore);
    const tx = engine.createTransaction('external-no-options');

    tx.set(externalStore, (draft) => {
      draft.count += 1;
    });
    tx.mutation = async () => 'done';

    await expect(tx.commit<string>()).resolves.toBe('done');
    expect(externalStore.getState().count).toBe(11);
  });

  it('should merge multiple patch records for the same store', async () => {
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store);
    const tx = engine.createTransaction('merge-records');

    tx.set((draft) => {
      draft.count += 1;
    });
    tx.set((draft) => {
      draft.other += 1;
    });
    tx.mutation = async () => 'done';

    await expect(tx.commit<string>()).resolves.toBe('done');
    expect(store.getState()).toEqual({ count: 1, nested: { value: 0 }, other: 1 });
  });

  it('should trim history according to maxHistory', async () => {
    let latestSnapshots: OptimisticMutationSnapshot[] = [];
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store, {
      maxHistory: 1,
      onQueueChange: (snapshots) => {
        latestSnapshots = snapshots;
      },
    });

    for (const name of ['first', 'second']) {
      const tx = engine.createTransaction(name);
      tx.set((draft) => {
        draft.count += 1;
      });
      tx.mutation = async () => name;
      await tx.commit<string>();
    }

    expect(latestSnapshots).toHaveLength(1);
    expect(latestSnapshots[0].actionName).toBe('second');
  });

  it('should allow no-op patches while still running the mutation', async () => {
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engine = new OptimisticEngine(store);
    const tx = engine.createTransaction('noop');

    tx.set(() => {});
    tx.mutation = async () => 'noop';

    await expect(tx.commit<string>()).resolves.toBe('noop');
    expect(store.getState().count).toBe(0);
  });

  it('should throw on invalid transaction usage', async () => {
    const store = createTestStore({ count: 0, nested: { value: 0 }, other: 0 });
    const engineWithoutDefaultStore = new OptimisticEngine<TestState>();
    const missingDefaultStoreTx = engineWithoutDefaultStore.createTransaction('missing-default');

    expect(() =>
      missingDefaultStoreTx.set((draft) => {
        draft.count += 1;
      }),
    ).toThrow('no default store set');

    const missingMutationTx = new OptimisticEngine(store).createTransaction('missing-mutation');
    missingMutationTx.set((draft) => {
      draft.count += 1;
    });
    await expect(async () => missingMutationTx.commit()).rejects.toThrow('missing remote mutation');

    const committedTx = new OptimisticEngine(store).createTransaction('committed');
    committedTx.set((draft) => {
      draft.count += 1;
    });
    committedTx.mutation = async () => 'done';
    await committedTx.commit<string>();

    expect(() =>
      committedTx.set((draft) => {
        draft.count += 1;
      }),
    ).toThrow('cannot call set() after commit()');

    await expect(async () => committedTx.commit()).rejects.toThrow('transaction already committed');
  });
});
