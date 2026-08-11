import type { DesktopProjectionHydration } from '@lobechat/electron-client-ipc';

import { projectionBootSpanNames } from '@/libs/bootMetrics/spanNames';
import { bootTiming } from '@/libs/bootTiming';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { decodeProjectionHydration, encodeProjectionCommit } from './codec';
import type { ProjectionPersistence } from './types';

const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

const recordAsyncSpan = async <T>(
  name: string,
  operation: () => Promise<T>,
): Promise<{ completedAt: number; result: T; startedAt: number }> => {
  const startedAt = now();
  try {
    const result = await operation();
    const completedAt = now();
    bootTiming.recordSpan(name, startedAt, completedAt - startedAt);
    return { completedAt, result, startedAt };
  } catch (error) {
    const completedAt = now();
    bootTiming.recordSpan(name, startedAt, completedAt - startedAt);
    throw error;
  }
};

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
    hydrate: (scope, request) => {
      const queuedAt = now();
      return runInOrder(scope, async () => {
        const operationStartedAt = now();
        bootTiming.recordSpan(
          projectionBootSpanNames.queueWait,
          queuedAt,
          operationStartedAt - queuedAt,
        );
        const {
          completedAt: ipcCompletedAt,
          result: hydration,
          startedAt: ipcStartedAt,
        } = await recordAsyncSpan<DesktopProjectionHydration>(
          projectionBootSpanNames.ipcRoundtrip,
          () => ensureElectronIpc().projectionCache.hydrate({ ...request, scope }),
        );

        const databaseReadMs = hydration.timing?.databaseReadMs;
        if (
          typeof databaseReadMs === 'number' &&
          Number.isFinite(databaseReadMs) &&
          databaseReadMs >= 0
        ) {
          // Main and renderer processes have different performance time origins.
          // Anchor the exact main-process duration to the end of its containing IPC span.
          bootTiming.recordSpan(
            projectionBootSpanNames.databaseRead,
            Math.max(ipcStartedAt, ipcCompletedAt - databaseReadMs),
            databaseReadMs,
          );
        }

        return bootTiming.spanSync(projectionBootSpanNames.decode, () =>
          decodeProjectionHydration(hydration),
        );
      });
    },
  };
};
