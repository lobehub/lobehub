import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useTopicId } from '../../hooks/useTopicId';
import { useModelCatalog } from './useModelCatalog';

/** Both the model and speed menus read the catalog of the actual execution host. */
export const useTargetModelCatalog = ({
  agentId,
  enabled = true,
  open,
  type,
}: {
  agentId?: string;
  enabled?: boolean;
  open: boolean;
  type: ListHeterogeneousAgentModelsParams['type'];
}) => {
  const topicId = useTopicId();
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId,
  });
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);
  const isDeviceListLoading = !useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const cwd = useEffectiveWorkingDirectory(agentId, { homeFallback: false, topicId });
  const provider = agencyConfig?.heterogeneousProvider;
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: true,
    workspaceScoped,
  });
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  const useLocalIpc = isDesktop && executionTarget === 'local';
  const deviceId = useLocalIpc ? undefined : targetDeviceId;
  const targetReady = enabled && (useLocalIpc || (executionTarget === 'device' && !!deviceId));
  const catalog = useModelCatalog({
    cwd,
    deviceId,
    isDeviceListLoading,
    isPreferenceLoading,
    open,
    provider,
    targetReady,
    type,
  });
  return { ...catalog, targetReady };
};
