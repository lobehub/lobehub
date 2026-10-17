import type { DeviceExecutionTarget } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { getTopicBoundDeviceId } from '@/helpers/executionTarget';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { moveTopicToTarget } from './moveTopicToTarget';
import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';

interface TargetDevice {
  deviceId: string;
  friendlyName?: string | null;
  hostname?: string | null;
}

interface UseTopicAwareTargetSelectOptions {
  agentId: string;
  /** This desktop's own gateway device id, when known. */
  currentDeviceId?: string;
  devices?: TargetDevice[];
  selectExecutionTarget: ReturnType<typeof useSelectExecutionTarget>;
  /** The composer's own topic (see `useTopicId`); `null` when it has none. */
  topicId: string | null;
}

/**
 * Pick an execution target for the agent while honouring the composer topic's
 * machine binding: a topic that already ran on another machine is moved only
 * after confirmation, and the move drops the cwd and CLI session that only hold
 * on the old machine.
 */
export const useTopicAwareTargetSelect = ({
  agentId,
  currentDeviceId,
  devices,
  selectExecutionTarget,
  topicId,
}: UseTopicAwareTargetSelectOptions) => {
  const { t } = useTranslation('chat');

  // `homeFallback: false` on purpose — this must reflect whether the user has
  // actually chosen a directory, not the runtime's convenience fallback.
  const configuredWorkingDirectory = useEffectiveWorkingDirectory(agentId, {
    homeFallback: false,
    topicId,
  });
  const { commit: commitWorkingDirectory } = useCommitWorkingDirectory(agentId, topicId);

  /**
   * Give a sandboxed agent somewhere to work when the user has not picked a
   * directory yet.
   *
   * The fence is scoped to the working directory, so without one the run is
   * refused — a first use that fails on a requirement the picker never
   * mentioned. Rather than fence a directory nobody chose *silently*, the
   * default is written into the same setting the chip reads, so the answer to
   * "where is this running?" stays visible and changeable.
   */
  // `force`: the caller just cleared the directory, which this closure cannot
  // see yet.
  const ensureSandboxWorkingDirectory = useCallback(
    async (force = false) => {
      if (configuredWorkingDirectory && !force) return;

      const { path } = await localFileService.ensureSandboxWorkspace({ agentId });
      // Leave it unset if the directory could not be created: pointing the fence
      // at a path that does not exist would fail later and less clearly.
      //
      // `localTarget` because the sandbox pick is about to make `local` the
      // target: the config still describes the previous one here, so without it a
      // workspace member's first pick would file the path against the shared
      // target (or nowhere) and the very next command would refuse again.
      if (path) await commitWorkingDirectory({ path }, { localTarget: true });
    },
    [agentId, commitWorkingDirectory, configuredWorkingDirectory],
  );

  // The machine the open topic already ran on. Its cwd and CLI session live
  // there, so the picker shows it (tagged) instead of the agent default, and
  // moving the topic elsewhere is an explicit, confirmed re-pin.
  const topicDeviceId = useChatStore((s) =>
    getTopicBoundDeviceId(topicId ? topicSelectors.getTopicById(topicId)(s) : undefined, agentId),
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const selectTarget = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string, localSandbox?: boolean) => {
      const apply = async () => {
        if (localSandbox) await ensureSandboxWorkingDirectory();
        await selectExecutionTarget(target, deviceId, { localSandbox });
      };

      const nextMachineId =
        target === 'device' ? deviceId : target === 'local' ? currentDeviceId : undefined;
      // `local` before this desktop's id resolved cannot say which machine it
      // is — leave the topic pin alone rather than unbinding it.
      const machineKnown = target !== 'local' || !!currentDeviceId;
      if (!topicId || !topicDeviceId || !machineKnown || nextMachineId === topicDeviceId) {
        await apply();
        return;
      }

      const topicDevice = devices?.find((d) => d.deviceId === topicDeviceId);
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('heteroAgent.executionTarget.switchTopic.content', {
          name:
            topicDeviceId === currentDeviceId
              ? t('heteroAgent.executionTarget.local')
              : (topicDevice?.friendlyName ??
                topicDevice?.hostname ??
                t('heteroAgent.executionTarget.unknownDevice')),
        }),
        okText: t('heteroAgent.executionTarget.switchTopic.ok'),
        onOk: async () => {
          const result = await moveTopicToTarget({
            afterRepin: localSandbox ? () => ensureSandboxWorkingDirectory(true) : undefined,
            // The cwd and session are bare values that only hold on the old
            // machine — drop them with the pin so the next turn resolves fresh
            // ones where it now runs.
            repinTopic: () =>
              updateTopicMetadata(topicId, {
                boundDeviceId: nextMachineId,
                heteroSessionBindingKey: undefined,
                heteroSessionBindingKeyByWorkingDirectory: undefined,
                heteroSessionId: undefined,
                heteroSessionIdByWorkingDirectory: undefined,
                workingDirectory: undefined,
                workingDirectoryConfig: undefined,
              }),
            saveTarget: () => selectExecutionTarget(target, deviceId, { localSandbox }),
          });
          // A refused/failed target save already toasted inside the hook.
          if (result === 'topic-not-saved') toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        },
        title: t('heteroAgent.executionTarget.switchTopic.title'),
      });
    },
    [
      currentDeviceId,
      devices,
      ensureSandboxWorkingDirectory,
      selectExecutionTarget,
      t,
      topicDeviceId,
      topicId,
      updateTopicMetadata,
    ],
  );

  return { selectTarget, topicDeviceId };
};
