'use client';

import { Segmented } from '@lobehub/ui/base-ui';
import { type CSSProperties, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import {
  type AgentProfileTab,
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  supportsMessageChannels,
} from './tabOptions';

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

/**
 * Segmented switcher shared by the agent profile group — Profile / Channels /
 * Statistics. The three surfaces are separate routes, so a segment writes the
 * URL rather than holding local state: deep links and back/forward keep working.
 */
const AgentProfileTabs = memo<AgentProfileTabsProps>(({ active, agentId }) => {
  const { t } = useTranslation(['chat', 'spend']);
  const navigate = useWorkspaceAwareNavigate();

  const heterogeneousProviderType = useAgentStore(
    agentSelectors.currentAgentHeterogeneousProviderType,
  );
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', agentId);
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);

  const canConfigure = !!isAgentEditable && isAccessResolved && canEditContent && canEditResource;
  const channelsSupported = supportsMessageChannels(heterogeneousProviderType);

  const options = useMemo(
    () =>
      buildAgentProfileTabOptions({
        active,
        canConfigure,
        channelsSupported,
        labels: {
          channel: t('tab.integration'),
          // Inside the profile group the whole surface *is* the agent profile,
          // so the first segment is the "basic" tab, not "Agent Profile" again —
          // that broader name stays on the sidebar entry that opens the group.
          profile: t('tab.profileBasic'),
          statistics: t('usageStats.title', { ns: 'spend' }),
        },
      }),
    [active, canConfigure, channelsSupported, t],
  );

  // A lone segment is a label, not a switcher.
  if (options.length < 2) return null;

  return (
    <Segmented
      options={options}
      size={'small'}
      value={active}
      // `Segmented` only fires on a *change*, so the active segment is inert —
      // notably on `/channel/:platform`, where Channels stays selected. Going
      // back to the platform list is the breadcrumb's job, not this switcher's.
      onChange={(value) => navigate(buildAgentProfileTabPath(agentId, value as AgentProfileTab))}
    />
  );
});

AgentProfileTabs.displayName = 'AgentProfileTabs';

export default AgentProfileTabs;
