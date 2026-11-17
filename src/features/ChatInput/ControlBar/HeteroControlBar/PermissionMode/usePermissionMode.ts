import type {
  HeteroPermissionMode,
  HeteroPermissionModeDir,
  HeteroPermissionModeFallback,
} from '@lobechat/types';
import { getWorktreeModeKey, readHeteroPermissionModeDir } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';
import {
  effectivePermissionMode,
  getLocalPermissionModeSwitcher,
  readTopicPermissionMode,
  setPendingHeteroPermissionMode,
} from '@/store/chat/heteroPermissionMode';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import type { UserState } from '@/store/user/initialState';

/**
 * The remembered modes of whoever is acting now: this member's workspace bucket
 * inside a workspace, `users.preference` in personal mode. `undefined` while the
 * workspace bucket has not loaded.
 */
const selectPermissionModeDirs =
  (workspaceId: string | null | undefined) =>
  (state: UserState): HeteroPermissionModeDir[] | undefined => {
    if (!workspaceId) return state.preference.heteroPermissionModeDirs ?? [];
    return state.workspaceUserPreferenceWorkspaceId === workspaceId
      ? (state.workspaceUserPreference.heteroPermissionModeDirs ?? [])
      : undefined;
  };

/** Why a mid-run switch did not reach the session, as the user should read it. */
type SwitchFailure = 'switchFailed' | 'switchUnsupported';

const switchRunningSession = async (
  topicId: string,
  runningOperationId: string | undefined,
  mode: HeteroPermissionMode,
): Promise<SwitchFailure | undefined> => {
  const local = getLocalPermissionModeSwitcher(topicId);
  if (local) {
    try {
      await local(mode);
      return;
    } catch {
      return 'switchFailed';
    }
  }
  if (!runningOperationId) return;

  try {
    const result = await aiAgentService.setHeteroPermissionMode({
      mode,
      operationId: runningOperationId,
    });
    if (result.status === 'accepted') return;
    return result.status === 'unsupported' || result.status === 'unreachable'
      ? 'switchUnsupported'
      : 'switchFailed';
  } catch {
    return 'switchFailed';
  }
};

export interface PermissionModeState {
  /** Why the last run was not in `mode`; the chip explains it. */
  fallback?: HeteroPermissionModeFallback | null;
  /** The picked mode: what the topic's next run starts in. */
  mode: HeteroPermissionMode;
  /** The mode the topic's last run actually ran in. */
  runningMode: HeteroPermissionMode;
  select: (mode: HeteroPermissionMode) => Promise<void>;
}

/**
 * The composer's Claude Code permission mode (Better Coding Experience lab).
 *
 * - An existing topic shows its own mode, which Claude Code's reports keep
 *   current (leaving plan mode). Picking one writes it to the topic and, while
 *   a run is going, switches that session at once.
 * - A new topic shows the mode last picked for this device + directory and is
 *   born with it.
 *
 * Every pick is also remembered for the directory, per workspace + user.
 */
export const usePermissionMode = (
  agentId: string,
  topicId: string | null | undefined,
): PermissionModeState => {
  const { t } = useTranslation('chat');
  const workspaceId = useActiveWorkspaceId();
  useUserStore((s) => s.useFetchWorkspaceUserPreference)();
  const dirs = useUserStore(selectPermissionModeDirs(workspaceId));
  const setPermissionModeDir = useUserStore((s) => s.setHeteroPermissionModeDir);

  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  const directory =
    getWorkingDirectoryPathString(useEffectiveWorkingDirectory(agentId, { topicId })) ?? '';
  const key = getWorktreeModeKey(targetDeviceId ?? 'local', directory);

  const metadata = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata : undefined,
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const remembered = readHeteroPermissionModeDir(dirs, key);
  const mode = topicId ? readTopicPermissionMode(metadata) : remembered;
  const fallback = topicId ? metadata?.heteroPermissionModeFallback : undefined;

  // A topic created from this composer is born with what it shows. Not cleared
  // on unmount: the send switches the composer to the new topic before the
  // topic's metadata is assembled.
  useEffect(() => {
    if (!topicId) setPendingHeteroPermissionMode(agentId, remembered);
  }, [agentId, remembered, topicId]);

  const runningOperationId = metadata?.runningOperation?.operationId;

  const select = useCallback(
    async (next: HeteroPermissionMode) => {
      if (!topicId) setPendingHeteroPermissionMode(agentId, next);
      try {
        await Promise.all([
          setPermissionModeDir(key, next),
          topicId
            ? updateTopicMetadata(topicId, {
                heteroPermissionMode: next,
                heteroPermissionModeFallback: null,
              })
            : undefined,
        ]);
      } catch (error) {
        console.error('[usePermissionMode] save failed', error);
        toast.error(t('heteroAgent.permissionMode.saveFailed'));
        return;
      }
      if (!topicId) return;

      const failure = await switchRunningSession(topicId, runningOperationId, next);
      if (failure) toast.info(t(`heteroAgent.permissionMode.${failure}`));
    },
    [agentId, key, runningOperationId, setPermissionModeDir, t, topicId, updateTopicMetadata],
  );

  return { fallback, mode, runningMode: effectivePermissionMode(mode, fallback), select };
};
