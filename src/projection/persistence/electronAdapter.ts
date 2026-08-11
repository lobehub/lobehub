import { ensureElectronIpc } from '@/utils/electron/ipc';

import { decodeProjectionHydration, encodeProjectionCommit } from './codec';
import type { ProjectionPersistence } from './types';

export const createElectronProjectionPersistence = (): ProjectionPersistence => {
  const operationsInFlight = new Map<string, Promise<unknown>>();

  const runInOrder = async <T>(scope: string, operation: () => Promise<T>): Promise<T> => {
    const previous = operationsInFlight.get(scope) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    operationsInFlight.set(scope, current);

    try {
      return await current;
    } finally {
      if (operationsInFlight.get(scope) === current) operationsInFlight.delete(scope);
    }
  };

  return {
    clearScope: (scope) =>
      runInOrder(scope, () => ensureElectronIpc().projectionCache.clearScope({ scope })),
    commit: (scope, commit) =>
      runInOrder(scope, () =>
        ensureElectronIpc().projectionCache.commit(encodeProjectionCommit(scope, commit)),
      ),
    hydrateScope: (scope) =>
      runInOrder(scope, async () => {
        const hydration = await ensureElectronIpc().projectionCache.hydrateScope({ scope });
        return decodeProjectionHydration(hydration);
      }),
  };
};
