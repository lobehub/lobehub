'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate } from 'react-router';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { StyleSheet } from '@/utils/styles';

import Content from './Content';
import { useAgentShareSupported } from './useAgentShareSupported';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

/**
 * Full-page share management for one agent, the fourth segment of the agent
 * profile group. Sharing grants visitors real execution on the creator's
 * account, so the flow gets a deliberate page (deep-linkable, back/forward
 * aware) rather than a modal that any stray click dismisses.
 */
const AgentShareSettingsPage = memo(() => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { visible: shareVisible } = useAgentShareSupported(activeAgentId);

  // A deep link on an agent that can never be shared (workspace / builtin row),
  // or by an account outside the rollout allowlist with nothing live to revoke,
  // lands on the agent instead of a settings surface whose every control would
  // fail server-side. `undefined` (lookup still resolving) keeps the page so a
  // revocable share does not flash through a redirect.
  if (activeAgentId && shareVisible === false)
    return <Navigate replace to={`/agent/${activeAgentId}`} />;

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
          {activeAgentId && <Content agentId={activeAgentId} />}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

AgentShareSettingsPage.displayName = 'AgentShareSettingsPage';

export default AgentShareSettingsPage;
