import { isDesktop } from '@lobechat/const';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import type { DeviceListResult } from '@/store/device/useDeviceList';
import { useElectronStore } from '@/store/electron';

import type {
  ChannelAgentDraft,
  ChannelAgentEnvironment,
  ChannelAgentIssue,
} from './agentEnvironment';
import {
  changeChannelAgentDevice,
  getChannelAgentIssue,
  reconcileChannelAgentDraft,
} from './agentEnvironment';

export const useChannelAgentDraft = (
  draft: ChannelAgentDraft,
  devices: DeviceListResult,
  setDrafts: Dispatch<SetStateAction<ChannelAgentDraft[]>>,
) => {
  const { agentId } = draft;
  const sync = useAgentStore((s) => s.useHydrateAgentConfig)(true, agentId);
  const agent = useAgentStore((s) => s.agentMap[agentId]);
  const confirmed = useAgentStore(
    (s) => s.agentConfigReplica.entries[agentId]?.source === 'server',
  );
  const notFound = useAgentStore((s) => s.agentNotFoundMap[agentId]);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId: null,
  });
  const environment: ChannelAgentEnvironment = {
    agencyConfig,
    currentDeviceId,
    devices: devices.data,
    devicesConfirmed: devices.isConfirmed,
    devicesError: devices.error,
    isDesktop,
    model: agent?.model ?? undefined,
    workspaceScoped,
  };
  const sourceIssue: ChannelAgentIssue | undefined = sync.error
    ? 'configurationFailed'
    : notFound
      ? 'agentUnavailable'
      : !confirmed || !agent || isPreferenceLoading
        ? 'configurationLoading'
        : undefined;
  const resolved = reconcileChannelAgentDraft(draft, environment, sourceIssue);

  // This is a form snapshot, not another fetch/cache. Removing and re-adding an
  // Agent creates a new draft; an effect from its previous mount cannot overwrite it.
  useEffect(() => {
    if (resolved === draft) return;
    setDrafts((current) => current.map((item) => (item === draft ? resolved : item)));
  }, [draft, resolved, setDrafts]);

  const change = (patch: Partial<Pick<ChannelAgentDraft, 'deviceId' | 'workingDirectory'>>) => {
    setDrafts((current) =>
      current.map((item) => {
        if (item.agentId !== agentId) return item;
        const next =
          'deviceId' in patch
            ? { ...item, ...changeChannelAgentDevice(item, patch.deviceId, environment) }
            : { ...item, ...patch };
        return { ...next, issue: getChannelAgentIssue(next, environment) };
      }),
    );
  };

  const changeDevice = (deviceId: unknown) => {
    // Select emits undefined (not '') for its empty option. Clearing is an explicit
    // channel-local override and must clear the directory as well.
    if (deviceId === undefined || deviceId === null || typeof deviceId === 'string')
      change({ deviceId: deviceId || undefined });
  };

  return {
    change,
    changeDevice,
    draft: resolved,
    requiresDevice: getChannelAgentIssue({ agentId }, environment) === 'deviceRequired',
    retry: sync.mutate,
    sync,
  };
};
