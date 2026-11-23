import { isDesktop } from '@lobechat/const';
import { getCodexAppServerUnsupportedArgs } from '@lobechat/heterogeneous-agents/codexAppServerArgs';
import { CODEX_COLLABORATION_MODE_RUNTIME, getWorktreeModeKey } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';
import { findRunningServerOperationId } from '@/store/chat/heteroPermissionMode';
import {
  getLocalCollaborationModeSwitcher,
  setPendingHeteroPlanMode,
} from '@/store/chat/heteroPlanMode';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import { useAgentRunRuntimes } from '@/store/device/agentRunRuntimes/store';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import type { UserState } from '@/store/user/initialState';
import { labPreferSelectors } from '@/store/user/selectors';

/** Why the switch cannot be used here, as the tooltip explains it. */
export type PlanModeUnavailableReason = 'appServerLab' | 'unsupported';

/**
 * The remembered switches of whoever is acting now (workspace bucket, or
 * `users.preference` in personal mode); `undefined` while the bucket loads.
 */
const selectPlanModeDirs =
  (workspaceId: string | null | undefined) =>
  (state: UserState): string[] | undefined => {
    if (!workspaceId) return state.preference.heteroPlanModeDirs ?? [];
    return state.workspaceUserPreferenceWorkspaceId === workspaceId
      ? (state.workspaceUserPreference.heteroPlanModeDirs ?? [])
      : undefined;
  };

/**
 * Whether the Plan switch can reach Codex where this agent runs: the native
 * app-server, which needs its lab and arguments it can honor, and — on a
 * connected device — an `lh` that takes the switch (`codex-collaboration-mode-v1`).
 * The cloud sandbox, API auth and such arguments run `codex exec`, which has no
 * collaboration mode. Only the switch grays out: a topic keeps its choice.
 */
export const resolvePlanModeAvailability = ({
  appServerLab,
  authMode,
  deviceRuntimes,
  executionTarget,
  providerArgs,
}: {
  appServerLab: boolean;
  authMode?: string;
  /** The Codex provider's arguments: some (e.g. `--profile`) keep a run on `codex exec`. */
  providerArgs?: readonly string[];
  /** The device's agent-run runtimes; undefined while unknown. */
  deviceRuntimes?: readonly string[];
  executionTarget: string;
}): PlanModeUnavailableReason | undefined => {
  if (!appServerLab) return 'appServerLab';
  if (authMode === 'api') return 'unsupported';
  if (getCodexAppServerUnsupportedArgs([...(providerArgs ?? [])]).length > 0) return 'unsupported';
  if (executionTarget === 'local') return;
  if (executionTarget === 'device' && deviceRuntimes?.includes(CODEX_COLLABORATION_MODE_RUNTIME))
    return;
  return 'unsupported';
};

export interface PlanModeState {
  enabled: boolean;
  /** The switch flipped while this run goes: Codex takes it from the next turn. */
  nextTurnPending: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  unavailable?: PlanModeUnavailableReason;
}

/**
 * The composer's Codex Plan switch.
 *
 * - An existing topic shows its own `heteroPlanMode`; flipping it writes the
 *   topic and, mid-run, tells the live thread, which takes it from the next turn.
 * - A new topic shows the switch last left for this device + directory, and is
 *   born with it when it is on or was flipped here.
 *
 * Every flip is remembered for the directory, per workspace + user.
 */
export const usePlanMode = (agentId: string, topicId: string | null | undefined): PlanModeState => {
  const { t } = useTranslation('chat');
  const workspaceId = useActiveWorkspaceId();
  useUserStore((s) => s.useFetchWorkspaceUserPreference)();
  const dirs = useUserStore(selectPlanModeDirs(workspaceId));
  const setPlanModeDir = useUserStore((s) => s.setHeteroPlanModeDir);
  const appServerLab = useUserStore(labPreferSelectors.enableCodexAppServer);

  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  const directory =
    getWorkingDirectoryPathString(useEffectiveWorkingDirectory(agentId, { topicId })) ?? '';
  const key = getWorktreeModeKey(targetDeviceId ?? 'local', directory);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: true,
    workspaceScoped,
  });
  const runtimeDeviceId =
    executionTarget === 'device' && appServerLab ? agencyConfig?.boundDeviceId : undefined;
  const runtimes = useAgentRunRuntimes(runtimeDeviceId);
  const unavailable = resolvePlanModeAvailability({
    appServerLab,
    authMode: agencyConfig?.heterogeneousProvider?.authMode,
    providerArgs: agencyConfig?.heterogeneousProvider?.args,
    deviceRuntimes: runtimes,
    executionTarget,
  });

  const metadata = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata : undefined,
  );
  const liveRun = useChatStore((s) =>
    topicId ? operationSelectors.isAgentRuntimeRunningByContext({ agentId, topicId })(s) : false,
  );
  // A run hosted by `lh` that this window did not start (a reload) is only on the topic.
  const running = liveRun || !!metadata?.runningOperation;
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const remembered = !!dirs?.includes(key);
  // `undefined` until the user flips it in this composer: a new topic born off
  // inherits only an "on" it remembers, so it sends no mode at all.
  const [flipped, setFlipped] = useState<boolean | undefined>();
  const enabled = topicId ? metadata?.heteroPlanMode === true : (flipped ?? remembered);

  // Flipped during the run that is going now; cleared once that run ends.
  const [flippedDuringRun, setFlippedDuringRun] = useState(false);
  useEffect(() => {
    if (!running) setFlippedDuringRun(false);
  }, [running]);
  useEffect(() => {
    setFlipped(undefined);
    setFlippedDuringRun(false);
  }, [topicId, key]);

  // A topic created from this composer is born with what it shows. Not cleared
  // on unmount: the send switches the composer to the new topic first.
  useEffect(() => {
    if (topicId) return;
    setPendingHeteroPlanMode(
      agentId,
      unavailable ? undefined : (flipped ?? (remembered || undefined)),
    );
  }, [agentId, flipped, remembered, topicId, unavailable]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      void setPlanModeDir(key, next).catch((error) => {
        console.error('[usePlanMode] remembering the switch failed', error);
        toast.error(t('heteroAgent.planMode.saveFailed'));
      });
      if (!topicId) {
        setFlipped(next);
        return;
      }
      try {
        await updateTopicMetadata(topicId, { heteroPlanMode: next });
      } catch (error) {
        console.error('[usePlanMode] save failed', error);
        toast.error(t('heteroAgent.planMode.saveFailed'));
        return;
      }
      if (!running) return;
      setFlippedDuringRun(true);
      const mode = next ? 'plan' : 'default';
      // Best effort: the topic already has the pick, and the next run sends it.
      const local = getLocalCollaborationModeSwitcher(topicId);
      if (local) {
        await local(mode).catch(() => {});
        return;
      }
      const state = useChatStore.getState();
      const operationId = findRunningServerOperationId(state, topicId, metadata);
      if (operationId) {
        await aiAgentService.setHeteroCollaborationMode({ mode, operationId }).catch(() => {});
      }
    },
    [key, metadata, running, setPlanModeDir, t, topicId, updateTopicMetadata],
  );

  return {
    enabled,
    nextTurnPending: running && flippedDuringRun,
    setEnabled,
    unavailable,
  };
};
