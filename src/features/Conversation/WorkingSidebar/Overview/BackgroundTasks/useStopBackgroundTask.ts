import { useCallback, useEffect, useState } from 'react';

import { aiAgentService } from '@/services/aiAgent';
import { getLocalBackgroundTaskStopper } from '@/store/chat/slices/agentRun/actions/transports/hetero/backgroundTasks';

import type { BackgroundTaskStopRoute } from './backgroundTaskList';

/**
 * Why a stop did not go through, as the user should read it:
 * - `upgradeLh`: the device's `lh` cannot stop a task, or never picked the
 *   request up (an `lh` older than control messages never does);
 * - `noAnswer`: the device took the request and did not answer in time;
 * - `failed`: anything else.
 */
export type StopBackgroundTaskFailure = 'failed' | 'noAnswer' | 'upgradeLh';

/**
 * A stop accepted by Claude Code whose `stopped` snapshot never came back
 * frees the button after this long, so the user can try again.
 */
export const STOP_PENDING_RESET_MS = 20_000;

const requestStop = async (
  route: BackgroundTaskStopRoute,
  operationId: string,
  taskId: string,
): Promise<StopBackgroundTaskFailure | undefined> => {
  if (route === 'local') {
    const stop = getLocalBackgroundTaskStopper(operationId);
    if (!stop) return 'failed';
    await stop(taskId);
    return;
  }

  const result = await aiAgentService.stopHeteroBackgroundTask({ operationId, taskId });
  switch (result.status) {
    case 'accepted': {
      return;
    }
    case 'unreachable':
    case 'unsupported': {
      return 'upgradeLh';
    }
    case 'timeout': {
      return 'noAnswer';
    }
    default: {
      return 'failed';
    }
  }
};

interface UseStopBackgroundTaskParams {
  onFailure: (failure: StopBackgroundTaskFailure) => void;
  operationId: string | undefined;
  route: BackgroundTaskStopRoute | undefined;
  /** Whether the task still shows as running. */
  running: boolean;
  taskId: string;
}

/**
 * Stop one background task. The task only reads as stopped once its `stopped`
 * snapshot lands; until then the row shows "stopping".
 */
export const useStopBackgroundTask = ({
  onFailure,
  operationId,
  route,
  running,
  taskId,
}: UseStopBackgroundTaskParams) => {
  const [stopping, setStopping] = useState(false);

  // The snapshot that ends the task also ends the wait.
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  useEffect(() => {
    if (!stopping) return;
    const timer = setTimeout(() => setStopping(false), STOP_PENDING_RESET_MS);
    return () => clearTimeout(timer);
  }, [stopping]);

  const stop = useCallback(async () => {
    if (!route || !operationId || stopping) return;
    setStopping(true);
    let failure: StopBackgroundTaskFailure | undefined;
    try {
      failure = await requestStop(route, operationId, taskId);
    } catch (error) {
      console.error('[BackgroundTasks] stop failed:', error);
      failure = 'failed';
    }
    if (failure) {
      setStopping(false);
      onFailure(failure);
    }
  }, [onFailure, operationId, route, stopping, taskId]);

  return { canStop: !!route && !!operationId && running, stop, stopping };
};
