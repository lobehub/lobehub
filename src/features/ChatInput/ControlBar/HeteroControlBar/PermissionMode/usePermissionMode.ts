import type {
  HeteroPermissionMode,
  HeteroPermissionModeDir,
  HeteroPermissionModeFallback,
} from '@lobechat/types';
import { getWorktreeModeKey, readHeteroPermissionModeDir } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';
import {
  clearSwitchUnapplied,
  effectivePermissionMode,
  findRunningServerOperationId,
  getLocalPermissionModeSwitcher,
  getUnappliedLiveMode,
  markSwitchUnapplied,
  readTopicPermissionMode,
  setPendingHeteroPermissionMode,
  subscribeUnappliedSwitches,
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

/**
 * Switch the topic's running session, if it has one. `taken` is the mode the
 * session reports it took — `acceptEdits` for a bypass pick as root — when
 * the host says.
 */
const switchRunningSession = async (
  topicId: string,
  mode: HeteroPermissionMode,
): Promise<{ failure?: SwitchFailure; taken?: HeteroPermissionMode }> => {
  const local = getLocalPermissionModeSwitcher(topicId);
  if (local) {
    try {
      return { taken: (await local(mode)) || undefined };
    } catch {
      return { failure: 'switchFailed' };
    }
  }
  const state = useChatStore.getState();
  const runningOperationId = findRunningServerOperationId(
    state,
    topicId,
    topicSelectors.getTopicById(topicId)(state)?.metadata,
  );
  if (!runningOperationId) return {};

  try {
    const result = await aiAgentService.setHeteroPermissionMode({
      mode,
      operationId: runningOperationId,
    });
    if (result.status === 'accepted') return { taken: 'mode' in result ? result.mode : undefined };
    return {
      failure:
        result.status === 'unsupported' || result.status === 'unreachable'
          ? 'switchUnsupported'
          : 'switchFailed',
    };
  } catch {
    return { failure: 'switchFailed' };
  }
};

export interface PermissionModeState {
  /** Why the last run was not in `mode`; the chip explains it. */
  fallback?: HeteroPermissionModeFallback | null;
  /** The picked mode: what the topic's next run starts in. */
  mode: HeteroPermissionMode;
  /** The mode the topic's run is actually in. */
  runningMode: HeteroPermissionMode;
  select: (mode: HeteroPermissionMode) => Promise<void>;
  /** The running session did not take `mode`; it applies from the next message. */
  switchPending: boolean;
}

/**
 * The composer's Claude Code permission mode.
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
  const unappliedLiveMode = useSyncExternalStore(
    subscribeUnappliedSwitches,
    () => getUnappliedLiveMode(topicId),
    () => undefined,
  );
  const runningMode = unappliedLiveMode ?? effectivePermissionMode(mode, fallback);

  // A topic created from this composer is born with what it shows. Not cleared
  // on unmount: the send switches the composer to the new topic before the
  // topic's metadata is assembled.
  useEffect(() => {
    if (!topicId) setPendingHeteroPermissionMode(agentId, remembered);
  }, [agentId, remembered, topicId]);

  const select = useCallback(
    async (next: HeteroPermissionMode) => {
      // Remembering the pick for the directory is independent of this topic and
      // its run: a failure there must not stop the switch.
      void setPermissionModeDir(key, next).catch((error) => {
        console.error('[usePermissionMode] remembering the mode failed', error);
        toast.error(t('heteroAgent.permissionMode.saveFailed'));
      });
      if (!topicId) {
        setPendingHeteroPermissionMode(agentId, next);
        return;
      }

      try {
        await updateTopicMetadata(topicId, {
          heteroPermissionMode: next,
          heteroPermissionModeFallback: null,
        });
      } catch (error) {
        console.error('[usePermissionMode] save failed', error);
        toast.error(t('heteroAgent.permissionMode.saveFailed'));
        return;
      }

      // The mode the live session is in before this pick, should it not take it.
      const liveBefore = runningMode;
      const { failure, taken } = await switchRunningSession(topicId, next);
      if (failure) {
        if (liveBefore !== next) markSwitchUnapplied(topicId, liveBefore);
        toast.info(t(`heteroAgent.permissionMode.${failure}`));
        return;
      }
      clearSwitchUnapplied(topicId);
      // As root a bypass pick runs as acceptEdits: keep the pick, say why.
      if (taken && taken !== next) {
        await updateTopicMetadata(topicId, { heteroPermissionModeFallback: 'root' }).catch(
          () => {},
        );
      }
    },
    [agentId, key, runningMode, setPermissionModeDir, t, topicId, updateTopicMetadata],
  );

  return {
    fallback,
    mode,
    runningMode,
    select,
    switchPending: !!unappliedLiveMode && unappliedLiveMode !== mode,
  };
};
