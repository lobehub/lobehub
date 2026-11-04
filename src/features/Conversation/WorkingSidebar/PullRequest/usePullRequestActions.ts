import type { DeviceGitPullRequestAction, DeviceGitPullRequestActionResult } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useRef, useState } from 'react';

import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';
import { useGitStatusStore } from '@/store/device/gitStatus/store';

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
  /**
   * The PR is only known from persisted rows so far: refuse every mutation so
   * a click on stale content cannot act on a PR the branch has moved off.
   */
  locked?: boolean;
  mutateDetail: () => Promise<unknown>;
  number: number;
  /**
   * The merge context (permissions, required checks) is still last session's:
   * refuse policy-driven mutations, but let comments through.
   */
  policyLocked?: boolean;
  workingDirectory: string;
}

export const usePullRequestActions = ({
  deviceId,
  locked = false,
  mutateDetail,
  policyLocked = false,
  number,
  workingDirectory,
}: UsePullRequestActionsParams) => {
  const [busy, setBusy] = useState<PullRequestBusy>();
  const [error, setError] = useState<string>();
  const busyRef = useRef(false);
  const retryRef = useRef<() => Promise<boolean>>(undefined);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const policyLockedRef = useRef(policyLocked);
  policyLockedRef.current = policyLocked;

  const perform = useCallback(
    async (kind: PullRequestBusy, request: () => Promise<DeviceGitPullRequestActionResult>) => {
      if (busyRef.current || lockedRef.current) return false;
      if (policyLockedRef.current && kind !== 'comment') return false;
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
          mutate(deviceKeys.gitPullRequestActivity(cacheDeviceId, workingDirectory, number)),
          mutate(
            (key: unknown) =>
              Array.isArray(key) &&
              key[0] === deviceKeys.gitLinkedPR.root &&
              key[1] === cacheDeviceId &&
              key[2] === workingDirectory,
          ),
          mutate(
            (key: unknown) =>
              Array.isArray(key) &&
              key[0] === deviceKeys.gitPullRequestMergeContext.root &&
              key[1] === cacheDeviceId &&
              key[2] === workingDirectory &&
              key[3] === number,
          ),
          useGitStatusStore
            .getState()
            .revalidateGitStatus(deviceId, workingDirectory, ['aheadBehind', 'workingTreeStatus']),
        ]);
        return true;
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        setBusy(undefined);
      }
    },
    [deviceId, mutateDetail, number, workingDirectory],
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
