'use client';

import { Flexbox } from '@lobehub/ui';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { StyleSheet } from '@/utils/styles';

import IdentityAccounts from './IdentityAccounts';
import InboxSection from './InboxSection';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

interface AgentMailProps {
  agentId: string;
  /** Read-only viewer: addresses and mail stay readable, nothing can be opened or released. */
  disabled?: boolean;
}

/**
 * The agent's mail page: which addresses it owns, and what has arrived.
 *
 * Two sections rather than two tabs, because they answer one question — "is
 * anyone reaching this agent, and through what?" — and the inbox is only
 * meaningful next to the addresses that received it.
 */
const AgentMail = ({ agentId, disabled }: AgentMailProps) => (
  <Flexbox height={'100%'} width={'100%'}>
    <NavHeader
      left={<AgentBreadcrumb agentId={agentId} />}
      // `relative` anchors the absolutely-centered switcher below.
      style={{ position: 'relative' }}
      styles={{
        // Center on the header midpoint (equal gaps), not the leftover track.
        center: AGENT_PROFILE_TABS_CENTER_STYLE,
        left: { minWidth: 0, paddingInlineStart: 8 },
      }}
    >
      <AgentProfileTabs active={'mail'} agentId={agentId} />
    </NavHeader>
    <Flexbox flex={1} style={styles.body} width={'100%'}>
      <WideScreenContainer>
        <Flexbox gap={24} paddingBlock={16}>
          <IdentityAccounts agentId={agentId} disabled={disabled} />
          <InboxSection agentId={agentId} />
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default AgentMail;
