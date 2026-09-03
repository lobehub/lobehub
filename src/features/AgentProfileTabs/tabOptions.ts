import { EXTERNAL_INTEGRATIONS_ENABLED } from '@lobechat/business-const';
import urlJoin from 'url-join';

export type AgentProfileTab = 'channel' | 'profile' | 'share' | 'statistics';

export interface AgentProfileTabOption {
  label: string;
  value: AgentProfileTab;
}

/**
 * Message channels exist for cloud agents and for the two CLI providers whose
 * runtime can host them — a device-only heterogeneous agent has nothing to
 * connect, so the segment must not be offered.
 *
 * Channels are also the external-messenger surface (Discord, Slack, Feishu,
 * WeChat, …), so a distribution shipping none of those has nothing behind the
 * segment at all — the route itself already bounces back out in that case.
 */
export const supportsMessageChannels = (heterogeneousProviderType?: string) =>
  EXTERNAL_INTEGRATIONS_ENABLED &&
  (!heterogeneousProviderType ||
    heterogeneousProviderType === 'claude-code' ||
    heterogeneousProviderType === 'codex');

export const buildAgentProfileTabPath = (agentId: string, tab: AgentProfileTab) =>
  urlJoin('/agent', agentId, tab);

/**
 * Which segments the profile-group switcher shows.
 *
 * `canConfigure` is the same gate `ResourceConfigAccessGate` applies to the
 * Profile / Channels routes: without edit-level access those pages bounce the
 * member straight back out with a toast, so the segment must not offer the
 * click. Statistics carries no such gate and is always listed.
 *
 * The tab owned by the current page is always kept, even when the gates would
 * drop it — otherwise `value` would point at no option and the switcher would
 * render with nothing selected on the very page that owns it.
 */
export const buildAgentProfileTabOptions = ({
  active,
  canConfigure,
  channelsSupported,
  labels,
  shareSupported,
}: {
  active: AgentProfileTab;
  canConfigure: boolean;
  channelsSupported: boolean;
  labels: Record<AgentProfileTab, string>;
  shareSupported: boolean;
}): AgentProfileTabOption[] => {
  const showProfile = canConfigure || active === 'profile';
  const showChannel = (canConfigure && channelsSupported) || active === 'channel';
  // Sharing hands visitors real execution on the owner's account, so the
  // segment follows the same configure gate as Profile / Channels on top of the
  // capability gate (personal, non-builtin agents on deployments that allow it).
  const showShare = (canConfigure && shareSupported) || active === 'share';

  return [
    showProfile ? { label: labels.profile, value: 'profile' as const } : null,
    showChannel ? { label: labels.channel, value: 'channel' as const } : null,
    { label: labels.statistics, value: 'statistics' as const },
    showShare ? { label: labels.share, value: 'share' as const } : null,
  ].filter((option) => !!option);
};
