import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { DeviceListItem, LobeAgentAgencyConfig } from '@lobechat/types';
import { getWorkingDirEffectivePath, isChannelRuntime } from '@lobechat/types';

import type { ChannelAgentSelection } from '@/services/channel';

export interface ChannelAgentDraft extends ChannelAgentSelection {
  initialized: boolean;
  issue?: ChannelAgentIssue;
}

export type ChannelAgentIssue =
  | 'agentUnavailable'
  | 'configurationFailed'
  | 'configurationLoading'
  | 'deviceOffline'
  | 'deviceRequired'
  | 'deviceUnavailable'
  | 'devicesFailed'
  | 'devicesLoading'
  | 'directoryRequired'
  | 'unsupportedRuntime';

export interface ChannelAgentEnvironment {
  agencyConfig?: LobeAgentAgencyConfig;
  currentDeviceId?: string;
  devices?: DeviceListItem[];
  devicesConfirmed: boolean;
  devicesError?: unknown;
  isDesktop: boolean;
  model?: string;
  workspaceScoped?: boolean;
}

const getRuntime = ({ agencyConfig, model }: ChannelAgentEnvironment) =>
  agencyConfig?.heterogeneousProvider?.type ??
  (isHeterogeneousAgentModelId(model) ? model! : 'native');

const getDeviceDirectory = (deviceId: string | undefined, environment: ChannelAgentEnvironment) => {
  if (!deviceId) return;
  const configured = environment.agencyConfig?.workingDirByDevice?.[deviceId];
  return (
    getWorkingDirEffectivePath(configured) ||
    (environment.devicesConfirmed
      ? environment.devices?.find((device) => device.deviceId === deviceId)?.defaultCwd || undefined
      : undefined)
  );
};

/** Snapshot only the Agent's chosen machine, never another available/online device. */
export const createChannelAgentSelection = (
  agentId: string,
  environment: ChannelAgentEnvironment,
): ChannelAgentSelection => {
  const { agencyConfig, currentDeviceId, isDesktop, workspaceScoped } = environment;
  const target = agencyConfig?.executionTarget;
  if (target === 'none' || target === 'sandbox' || target === 'auto') return { agentId };
  const localDefault =
    isDesktop &&
    !workspaceScoped &&
    (target === 'local' || (target === undefined && getRuntime(environment) !== 'native'));
  const deviceId = agencyConfig?.boundDeviceId || (localDefault ? currentDeviceId : undefined);
  if (!deviceId) return { agentId };
  return { agentId, deviceId, workingDirectory: getDeviceDirectory(deviceId, environment) };
};

export interface ChannelAgentIssueOptions {
  /** Inherited defaults may omit the directory; the server then uses the device's home folder. */
  directoryOptional?: boolean;
}

export const getChannelAgentIssue = (
  selection: ChannelAgentSelection,
  environment: ChannelAgentEnvironment,
  { directoryOptional }: ChannelAgentIssueOptions = {},
): ChannelAgentIssue | undefined => {
  const runtime = getRuntime(environment);
  if (!isChannelRuntime(runtime)) return 'unsupportedRuntime';
  if (!selection.deviceId) return runtime === 'native' ? undefined : 'deviceRequired';
  if (environment.devicesError) return 'devicesFailed';
  if (!environment.devicesConfirmed) return 'devicesLoading';
  const device = environment.devices?.find((item) => item.deviceId === selection.deviceId);
  if (!device || (device.scope === 'workspace' && device.visibility !== 'public'))
    return 'deviceUnavailable';
  if (device.onlineUnknown) return 'devicesLoading';
  if (!device.online) return 'deviceOffline';
  if (!directoryOptional && !selection.workingDirectory?.trim()) return 'directoryRequired';
};

export const changeChannelAgentDevice = (
  selection: ChannelAgentSelection,
  deviceId: string | undefined,
  environment: ChannelAgentEnvironment,
): ChannelAgentSelection => ({
  ...selection,
  deviceId,
  workingDirectory: getDeviceDirectory(deviceId, environment),
});

/** Hydration may finish after selection; defaults apply once, never over a user's edits. */
export const reconcileChannelAgentDraft = (
  draft: ChannelAgentDraft,
  environment: ChannelAgentEnvironment,
  sourceIssue?: ChannelAgentIssue,
  options?: ChannelAgentIssueOptions,
): ChannelAgentDraft => {
  let next = draft;
  let issue = sourceIssue;
  if (!issue) {
    if (!draft.initialized) {
      const selection = createChannelAgentSelection(draft.agentId, environment);
      if (selection.deviceId && (environment.devicesError || !environment.devicesConfirmed)) {
        issue = environment.devicesError ? 'devicesFailed' : 'devicesLoading';
      } else {
        next = { ...draft, ...selection, initialized: true };
      }
    }
    issue ??= getChannelAgentIssue(next, environment, options);
  }
  return next === draft && draft.issue === issue ? draft : { ...next, issue };
};

export const canSubmitChannelAgents = (agents: ChannelAgentDraft[]) =>
  agents.length > 0 && agents.every((agent) => agent.initialized && !agent.issue);

/** Only send the channel-local choices, never form state or Agent configuration. */
export const toChannelAgentSelection = (draft: ChannelAgentDraft): ChannelAgentSelection => {
  const { initialized: _initialized, issue: _issue, ...selection } = draft;
  return selection;
};
