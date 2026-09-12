import type { DeviceGitPullRequestAction, DeviceGitPullRequestActionResult } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useRef, useState } from 'react';

import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';

export type PullRequestBusy = DeviceGitPullRequestAction['type'] | 'push';

const DOCK_KINDS = new Set<PullRequestBusy>([
  'autoMerge',
  'merge',
  'push',
  'ready',
  'updateBranch',
]);

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
  const busyRef = useRef(false);
  const retryRef = useRef<() => Promise<boolean>>(undefined);

  const perform = useCallback(
    async (kind: PullRequestBusy, request: () => Promise<DeviceGitPullRequestActionResult>) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(kind);
      const isDockAction = DOCK_KINDS.has(kind);
      if (isDockAction) setError(undefined);
      const fail = (message: string) => {
        if (isDockAction) {
          setError(message);
          retryRef.current = () => perform(kind, request);
        } else {
          toast.error(message);
        }
        return false;
      };
      try {
        const result = await request();
        if (!result.success) return fail(result.error || 'unknown error');
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
        return fail(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        setBusy(undefined);
      }
    },
    [deviceId, mutateDetail, workingDirectory],
  );

  const run = useCallback(
    (action: DeviceGitPullRequestAction) =>
      perform(action.type, () =>
        gitService.runPullRequestAction({ action, deviceId, number, path: workingDirectory }),
      ),
    [deviceId, number, perform, workingDirectory],
  );

  const push = useCallback(
    () => perform('push', () => gitService.pushGitBranch({ deviceId, path: workingDirectory })),
    [deviceId, perform, workingDirectory],
  );

  const retry = useCallback(() => void retryRef.current?.(), []);

  const dismissError = useCallback(() => setError(undefined), []);

  return { busy, dismissError, error, push, retry, run };
};
