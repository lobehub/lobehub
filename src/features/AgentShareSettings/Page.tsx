'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate } from 'react-router';

import AgentShareSettingsExtension from '@/business/client/features/AgentShareSettingsExtension';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { StyleSheet } from '@/utils/styles';

import SettingsContent from './SettingsContent';
import VisibilitySection from './VisibilitySection';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

/**
 * Full-page share management for one agent (LOBE-11944): visibility + link on
 * top, business budget/usage slot in the middle, then the permission / tool /
 * limit configuration. Replaces the previous share popover + settings modal —
 * sharing an agent grants visitors real execution on the creator's account, so
 * the flow deserves a deliberate page, not a quick popup.
 */
const AgentShareSettingsPage = memo(() => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const enableAgentLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  // Deep links on deployments without the link-share capability land on the
  // profile page instead of a broken settings surface.
  if (!enableAgentLinkShare && activeAgentId)
    return <Navigate replace to={`/agent/${activeAgentId}/profile`} />;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        // No section title — the Segmented beside it names the current tab.
        left={activeAgentId ? <AgentBreadcrumb agentId={activeAgentId} /> : null}
        // `relative` anchors the absolutely-centered switcher below.
        style={{ position: 'relative' }}
        styles={{
          // Center on the header midpoint (equal gaps), not the leftover track.
          center: AGENT_PROFILE_TABS_CENTER_STYLE,
          left: { minWidth: 0, paddingInlineStart: 8 },
        }}
      >
        {activeAgentId && <AgentProfileTabs active={'share'} agentId={activeAgentId} />}
      </NavHeader>
      <Flexbox flex={1} style={styles.body} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={16} paddingBlock={16}>
            {activeAgentId && (
              <>
                <VisibilitySection agentId={activeAgentId} />
                <AgentShareSettingsExtension agentId={activeAgentId} />
                <SettingsContent agentId={activeAgentId} />
              </>
            )}
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

AgentShareSettingsPage.displayName = 'AgentShareSettingsPage';

export default AgentShareSettingsPage;
