'use client';

import { isDesktop } from '@lobechat/const';
import { type DeviceExecutionTarget, snapshotTopicExecutionConfig } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { useTopicAgencyConfig } from '@/hooks/useTopicAgencyConfig';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

export interface SelectExecutionTargetOptions {
  localSandbox?: boolean;
  localSandboxNetwork?: boolean;
  silent?: boolean;
}

/** Capture the destination before device discovery or persistence can yield. */
export const useSelectExecutionTarget = (agentId: string) => {
  const { agencyConfig, canSelectExecutionTarget } = useTopicAgencyConfig(agentId);
  const topicId = useChatStore((s) => (s.activeAgentId === agentId ? s.activeTopicId : undefined));
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  return async (
    target: DeviceExecutionTarget,
    deviceId?: string,
    options?: SelectExecutionTargetOptions,
  ) => {
    if (!canSelectExecutionTarget) return;
    // An automatic default must not create an empty conversation on mount.
    if (options?.silent && !topicId) return;
    try {
      let boundDeviceId = target === 'device' ? deviceId : undefined;
      if (target === 'local') {
        boundDeviceId =
          (isDesktop ? currentDeviceId : undefined) ??
          (await gatewayConnectionService.getDeviceInfo())?.deviceId;
        if (!boundDeviceId) return;
      }
      if (target === 'device' && !boundDeviceId) return;
      const store = useChatStore.getState();
      if (!topicId && (store.activeAgentId !== agentId || store.activeTopicId)) return;
      const destination = topicId ?? (await store.createTopic(agentId));
      if (!destination) return;
      await useChatStore.getState().updateTopicMetadata(destination, {
        executionConfig: {
          ...snapshotTopicExecutionConfig(agencyConfig),
          inheritWorkspaceScope: false,
          boundDeviceId,
          executionTarget: target,
          ...(options?.localSandbox === undefined ? {} : { localSandbox: options.localSandbox }),
          ...(options?.localSandboxNetwork === undefined
            ? {}
            : { localSandboxNetwork: options.localSandboxNetwork }),
        },
      });
      if (
        !topicId &&
        useChatStore.getState().activeAgentId === agentId &&
        !useChatStore.getState().activeTopicId
      ) {
        await useChatStore.getState().switchTopic(destination);
      }
    } catch {
      if (!options?.silent) toast.error(t('saveAgentConfigFail', { ns: 'common' }));
    }
  };
};
