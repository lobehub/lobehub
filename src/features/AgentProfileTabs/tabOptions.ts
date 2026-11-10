import urlJoin from 'url-join';

export type AgentProfileTab =
  'channel' | 'mail' | 'profile' | 'self-evolving' | 'share' | 'statistics';

export interface AgentProfileTabOption {
  label: string;
  value: AgentProfileTab;
}

export type AgentProfileTabGroupKey = 'general' | 'identity' | 'profile';

export interface AgentProfileTabGroup {
  key: AgentProfileTabGroupKey;
  options: AgentProfileTabOption[];
}

export const buildAgentProfileTabPath = (agentId: string, tab: AgentProfileTab) =>
  urlJoin('/agent', agentId, tab);

const AGENT_PROFILE_ROUTE =
  /^(?:\/[^/]+)?\/agent\/[^/]+\/(profile|mail(?:\/[^/]+)?|channel(?:\/[^/]+)?|self-evolving(?:\/[^/]+)*|statistics|share)\/?$/;

/**
 * The profile-group tab a URL belongs to, if any. Anchored on Agent subroutes,
 * not substrings: `/channels/:id` and workspace slugs such as `channel-team`
 * are not part of the group.
 */
export const getAgentProfileTab = (pathname: string): AgentProfileTab | undefined => {
  const segment = AGENT_PROFILE_ROUTE.exec(
    pathname.replace(/^\/_dangerous_local_dev_proxy(?=\/)/, ''),
  )?.[1];

  return segment?.split('/')[0] as AgentProfileTab | undefined;
};

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
  labels,
  mailSupported,
  selfLearningSupported,
  shareSupported,
}: {
  active: AgentProfileTab;
  canConfigure: boolean;
  labels: Record<AgentProfileTab, string>;
  mailSupported: boolean;
  selfLearningSupported: boolean;
  shareSupported: boolean;
}): AgentProfileTabOption[] => {
  const showProfile = canConfigure || active === 'profile';
  const showMail = (canConfigure && mailSupported) || active === 'mail';
  // Channels can dispatch to a bound device; cloud sandbox support is not required.
  const showChannel = canConfigure || active === 'channel';
  // Sharing hands visitors real execution on the owner's account, so the
  // segment follows the same configure gate as Profile / Channels on top of the
  // capability gate (personal, non-builtin agents on deployments that allow it).
  const showShare = (canConfigure && shareSupported) || active === 'share';
  const showSelfLearning = selfLearningSupported || active === 'self-evolving';

  return [
    showProfile ? { label: labels.profile, value: 'profile' as const } : null,
    showMail ? { label: labels.mail, value: 'mail' as const } : null,
    showChannel ? { label: labels.channel, value: 'channel' as const } : null,
    showSelfLearning ? { label: labels['self-evolving'], value: 'self-evolving' as const } : null,
    { label: labels.statistics, value: 'statistics' as const },
    showShare ? { label: labels.share, value: 'share' as const } : null,
  ].filter((option) => !!option);
};

const AGENT_PROFILE_TAB_GROUPS: { key: AgentProfileTabGroupKey; tabs: AgentProfileTab[] }[] = [
  { key: 'profile', tabs: ['profile'] },
  { key: 'identity', tabs: ['mail', 'channel'] },
  { key: 'general', tabs: ['self-evolving', 'statistics', 'share'] },
];

/** Sidebar sections for the visible tabs; a section with nothing to open is left out. */
export const groupAgentProfileTabOptions = (
  options: AgentProfileTabOption[],
): AgentProfileTabGroup[] =>
  AGENT_PROFILE_TAB_GROUPS.map(({ key, tabs }) => ({
    key,
    options: tabs.flatMap((tab) => options.filter((option) => option.value === tab)),
  })).filter((group) => group.options.length > 0);
