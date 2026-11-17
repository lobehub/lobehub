import { useCallback, useEffect, useMemo } from 'react';

import { useElectronStore } from '@/store/electron';

import {
  draftBranchKey,
  type DraftGitTarget,
  registerDraftGitTarget,
  setDraftBranch,
  unregisterDraftGitTarget,
  useDraftGitStore,
} from './draftGitStore';

interface UseDraftBranchOptions {
  agentId: string;
  /** HEAD's branch in `path`, which the pick defaults to. */
  currentBranch?: string;
  deviceId?: string;
  /** False leaves nothing registered (an existing topic, or the lab off). */
  enabled: boolean;
  isGithub: boolean;
  path: string;
  sourcePath: string;
}

/**
 * The branch picked for a new topic's first send, and the registration that
 * lets the send find this directory. Picking HEAD's branch clears the pick, so
 * an untouched draft keeps following whatever HEAD is.
 */
export const useDraftBranch = ({
  agentId,
  currentBranch,
  deviceId,
  enabled,
  isGithub,
  path,
  sourcePath,
}: UseDraftBranchOptions) => {
  const localDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const keyDeviceId = deviceId ?? localDeviceId;

  const target = useMemo<DraftGitTarget | undefined>(
    () =>
      enabled && path
        ? { agentId, deviceId, isGithub, keyDeviceId, path, sourcePath: sourcePath || path }
        : undefined,
    [agentId, deviceId, enabled, isGithub, keyDeviceId, path, sourcePath],
  );

  useEffect(() => {
    if (!target) return;
    registerDraftGitTarget(target);
    return () => unregisterDraftGitTarget(target);
  }, [target]);

  const key = target ? draftBranchKey(target) : undefined;
  const picked = useDraftGitStore((s) => (key ? s.selections[key] : undefined));

  const select = useCallback(
    (branch: string) => {
      if (!key) return;
      setDraftBranch(key, branch === currentBranch ? undefined : branch);
    },
    [currentBranch, key],
  );

  return { keyDeviceId, select, selectedBranch: picked ?? currentBranch, target };
};
