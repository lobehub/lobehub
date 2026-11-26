import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { DeviceListItem, LobeAgentAgencyConfig } from '@lobechat/types';
import {
  defaultChannelAgentDirectory,
  isChannelRuntime,
  isRemoteChannelRuntime,
} from '@lobechat/types';

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
  | 'deviceUnavailable'
  | 'devicesFailed'
  | 'devicesLoading'
  | 'directoryRequired'
  | 'unsupportedRuntime';

export interface ChannelAgentEnvironment {
  agencyConfig?: LobeAgentAgencyConfig;
  devices?: DeviceListItem[];
  devicesConfirmed: boolean;
  devicesError?: unknown;
  model?: string;
}

/** Device issues of an inherited environment are fixed in the Agent's settings, not here. */
const INHERITED_ISSUES = ['deviceOffline', 'deviceUnavailable'] as const;

const isInheritedIssue = (issue: ChannelAgentIssue): issue is (typeof INHERITED_ISSUES)[number] =>
  (INHERITED_ISSUES as readonly ChannelAgentIssue[]).includes(issue);

/** The `channel` locale key that explains an issue. */
export const channelAgentIssueKey = (issue: ChannelAgentIssue, inherited?: boolean) =>
  inherited && isInheritedIssue(issue)
    ? (`environment.inherited.${issue}` as const)
    : (`environment.${issue}` as const);

const getRuntime = ({ agencyConfig, model }: ChannelAgentEnvironment) =>
  agencyConfig?.heterogeneousProvider?.type ??
  (isHeterogeneousAgentModelId(model) ? model! : 'native');

/** A remote-task Agent runs on its own host; a Channel picks no device for it. */
export const isRemoteChannelAgent = (environment: ChannelAgentEnvironment) =>
  isRemoteChannelRuntime(getRuntime(environment));

const getDeviceDirectory = (deviceId: string | undefined, environment: ChannelAgentEnvironment) => {
  if (!deviceId) return;
  return defaultChannelAgentDirectory(
    environment.agencyConfig,
    deviceId,
    environment.devicesConfirmed
      ? environment.devices?.find((device) => device.deviceId === deviceId)?.defaultCwd
      : undefined,
  );
};

/**
 * A Channel binds no device by default: the Agent runs where its own settings say until a member
 * picks a device for it here.
 */
export const createChannelAgentSelection = (agentId: string): ChannelAgentSelection => ({
  agentId,
});

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
  // No device picked: it follows the Agent's own settings, like an ordinary conversation.
  if (!selection.deviceId) return;
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
    if (!draft.initialized)
      next = { ...draft, ...createChannelAgentSelection(draft.agentId), initialized: true };
    issue ??= getChannelAgentIssue(next, environment, options);
  }
  return next === draft && draft.issue === issue ? draft : { ...next, issue };
};

export const canSubmitChannelAgents = (agents: ChannelAgentDraft[]) =>
  agents.length > 0 && agents.every((agent) => agent.initialized && !agent.issue);

/**
 * Every chosen Agent must be ready to run. A new Channel may start with only its creator, while
 * an invitation has to add someone.
 */
export const canSubmitChannelMembers = (
  agents: ChannelAgentDraft[],
  { creating, people }: { creating: boolean; people: number },
) => (!agents.length || canSubmitChannelAgents(agents)) && (creating || agents.length + people > 0);

/** Only send the channel-local choices, never form state or Agent configuration. */
export const toChannelAgentSelection = (draft: ChannelAgentDraft): ChannelAgentSelection => {
  const { initialized: _initialized, issue: _issue, ...selection } = draft;
  return selection;
};
