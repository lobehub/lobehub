import type { DesktopProjectionHydration } from '@lobechat/electron-client-ipc';

import { projectionBootSpanNames } from '@/libs/bootMetrics/spanNames';
import { bootTiming } from '@/libs/bootTiming';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { decodeProjectionHydration, encodeProjectionCommit } from './codec';
import type { ProjectionPersistence } from './types';

const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

/**
 * Split one round trip into inbound transport, main-process work, and renderer
 * delivery lag. `timing` carries a shared wall clock; the spans are laid back on
 * the renderer's `performance` timeline by offsetting from the send, so a long
 * round trip says which process was actually busy instead of only that one was.
 */
const recordRoundtripBreakdown = (
  timing: DesktopProjectionHydration['timing'],
  sentAtWall: number,
  sentAtPerf: number,
  settledAtWall: number,
): void => {
  if (!timing) return;

  const { completedAt, databaseReadMs, receivedAt } = timing;
  if (!Number.isFinite(receivedAt) || !Number.isFinite(completedAt)) return;

  const inboundMs = Math.max(0, receivedAt - sentAtWall);
  const mainWorkMs = Math.max(0, completedAt - receivedAt);
  const deliveryMs = Math.max(0, settledAtWall - completedAt);
  const mainWorkStart = sentAtPerf + inboundMs;

  bootTiming.recordSpan(projectionBootSpanNames.ipcInbound, sentAtPerf, inboundMs);
  bootTiming.recordSpan(projectionBootSpanNames.mainWork, mainWorkStart, mainWorkMs);
  bootTiming.recordSpan(
    projectionBootSpanNames.ipcDelivery,
    mainWorkStart + mainWorkMs,
    deliveryMs,
  );

  if (Number.isFinite(databaseReadMs) && databaseReadMs >= 0) {
    bootTiming.recordSpan(
      projectionBootSpanNames.databaseRead,
      mainWorkStart + Math.max(0, mainWorkMs - databaseReadMs),
      databaseReadMs,
    );
  }
};

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

  /**
   * Only writes are ordered. Reads bypass the queue: the main process already
   * serializes its own writes, and the Projection reducer drops observations
   * older than the ones it holds, so a read that overtakes a pending commit
   * can never regress the store — while queueing it behind a multi-record
   * commit transaction is what keeps a cold boot on network latency.
   */
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
    hydrate: async (scope, request) => {
      const sentAtWall = Date.now();
      const { result: hydration, startedAt: ipcStartedAt } =
        await recordAsyncSpan<DesktopProjectionHydration>(
          projectionBootSpanNames.ipcRoundtrip,
          () => ensureElectronIpc().projectionCache.hydrate({ ...request, scope }),
        );
      recordRoundtripBreakdown(hydration.timing, sentAtWall, ipcStartedAt, Date.now());

      return bootTiming.spanSync(projectionBootSpanNames.decode, () =>
        decodeProjectionHydration(hydration),
      );
    },
  };
};
