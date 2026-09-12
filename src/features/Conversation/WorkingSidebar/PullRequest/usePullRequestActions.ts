import type { DeviceGitPullRequestAction, DeviceGitPullRequestActionResult } from '@lobechat/types';
import { useCallback, useState } from 'react';

import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';

export type PullRequestBusy = DeviceGitPullRequestAction['type'] | 'push';

interface UsePullRequestActionsParams {
  deviceId?: string;
  mutateDetail: () => Promise<unknown>;
  number: number;
  workingDirectory: string;
}

export const usePullRequestActions = ({
  deviceId,
  mutateDetail,
  number,
  workingDirectory,
}: UsePullRequestActionsParams) => {
  const [busy, setBusy] = useState<PullRequestBusy>();
  const [error, setError] = useState<string>();
  const [lastAction, setLastAction] = useState<DeviceGitPullRequestAction>();

  const perform = useCallback(
    async (kind: PullRequestBusy, request: () => Promise<DeviceGitPullRequestActionResult>) => {
      if (busy) return false;
      setBusy(kind);
      setError(undefined);
      try {
        const result = await request();
        if (!result.success) {
          setError(result.error || 'unknown error');
          return false;
        }
        const cacheDeviceId = deviceId ?? 'local';
        await Promise.all([
          mutateDetail(),
          mutate(
            (key: unknown) =>
              Array.isArray(key) &&
              key[0] === deviceKeys.gitLinkedPR.root &&
              key[1] === cacheDeviceId &&
              key[2] === workingDirectory,
          ),
          mutate(deviceKeys.gitAheadBehind(cacheDeviceId, workingDirectory)),
          mutate(deviceKeys.gitWorkingTreeStatus(cacheDeviceId, workingDirectory)),
        ]);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    [busy, deviceId, mutateDetail, workingDirectory],
  );

  const run = useCallback(
    (action: DeviceGitPullRequestAction) => {
      setLastAction(action);
      return perform(action.type, () =>
        gitService.runPullRequestAction({ action, deviceId, number, path: workingDirectory }),
      );
    },
    [deviceId, number, perform, workingDirectory],
  );

  const push = useCallback(
    () => perform('push', () => gitService.pushGitBranch({ deviceId, path: workingDirectory })),
    [deviceId, perform, workingDirectory],
  );

  const retry = useCallback(() => {
    if (lastAction) void run(lastAction);
  }, [lastAction, run]);

  const dismissError = useCallback(() => setError(undefined), []);

  return { busy, dismissError, error, push, retry, run };
};
