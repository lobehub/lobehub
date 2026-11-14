'use client';

import { Select } from '@lobehub/ui';
import { type CSSProperties, memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isMobileSurface } from '@/utils/mobileSurface';

import { type AgentProfileTab, buildAgentProfileTabPath } from './tabOptions';
import { useAgentProfileTabOptions } from './useAgentProfileTabOptions';

export type { AgentProfileTab } from './tabOptions';

/**
 * Style for the host `NavHeader`'s `center` slot so the switcher sits on the
 * *header* midpoint with equal gaps on both sides — not merely centered within
 * the leftover flex track between the left/right slots (whose widths differ, so
 * that reads as space-between, not centered). Requires the NavHeader itself to
 * be `position: relative`. Shared by every page that hosts the switcher so the
 * three headers can't drift.
 */
export const AGENT_PROFILE_TABS_CENTER_STYLE: CSSProperties = {
  // Physical `left`/`top`, not `inset-inline-start`: the paired transform below
  // is physical (always shifts left/up), so a logical anchor would resolve to
  // `right: 50%` under an RTL locale while the transform still pulls left —
  // landing the switcher far left of center. Physical anchor + physical
  // transform compose correctly in both LTR and RTL.
  left: '50%',
  position: 'absolute',
  top: '50%',
  // Both axes: an absolutely-positioned flex child no longer inherits the row's
  // vertical centering, so center it explicitly rather than trusting top:auto.
  transform: 'translate(-50%, -50%)',
};

interface AgentProfileTabsProps {
  /** The tab owned by the page rendering this switcher. */
  active: AgentProfileTab;
  agentId: string;
}

const MobileAgentProfileTabs = memo<AgentProfileTabsProps>(({ active, agentId }) => {
  const navigate = useWorkspaceAwareNavigate();
  const options = useAgentProfileTabOptions(active, agentId);

  // A lone segment is a label, not a switcher.
  if (options.length < 2) return null;

  // A strip of segments cannot hold this many pages in the 44px header, so the current page is a
  // compact menu that lists the rest.
  return (
    <Select
      options={options}
      size={'small'}
      style={{ maxWidth: 180, minWidth: 120 }}
      value={active}
      // Picking the page already shown does nothing: on `/channel/:platform` Channels stays
      // selected, and going back to the platform list is the breadcrumb's job.
      onChange={(value) => {
        if (value !== active) navigate(buildAgentProfileTabPath(agentId, value as AgentProfileTab));
      }}
    />
  );
});

MobileAgentProfileTabs.displayName = 'MobileAgentProfileTabs';

/**
 * Page switcher for the agent profile group — Profile, Instruction, Engine, Channels,
 * Statistics, … — on mobile, which has no room for a sidebar. Desktop
 * switches them from the sidebar (`AgentSidebar/ProfileNav`). The surfaces are
 * separate routes, so a segment writes the URL rather than holding local state:
 * deep links and back/forward keep working.
 */
const AgentProfileTabs = (props: AgentProfileTabsProps) =>
  isMobileSurface() ? <MobileAgentProfileTabs {...props} /> : null;

export default AgentProfileTabs;
