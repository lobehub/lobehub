'use client';

import { memo, type ReactNode } from 'react';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import type { AgentProfilePreview } from '@/features/AgentProfileCard/useAgentProfileDetail';

import MemberProfilePopup from './MemberProfilePopup';
import { isAgentMention } from './mentionTarget';

interface MentionProfileTriggerProps {
  /** Prefilled Agent data so the card paints before the Agent loads. */
  agent?: Partial<AgentProfilePreview>;
  children: ReactNode;
  /** The mentioned Agent id or workspace member's user id. */
  id?: string | null;
  /** Mention kind from the editor metadata (`agent`, `member`, …), when known. */
  type?: string | null;
}

/**
 * Hovering an @mention shows who it is: the Agent's profile card or the
 * workspace member's card, the same ones Task assignees use. A mention that
 * resolves to neither (a removed member, personal mode) stays plain text.
 */
const MentionProfileTrigger = memo<MentionProfileTriggerProps>(({ agent, children, id, type }) => {
  const isAgent = isAgentMention(id, type);
  // The member card reads the shared directory; the request is deduplicated
  // across every mention on the page.
  useFetchWorkspaceMembers({ enabled: !!id && !isAgent });

  if (!id) return children;

  if (isAgent)
    return (
      <AgentProfilePopup agent={agent} agentId={id} trigger={'hover'}>
        <span style={{ display: 'inline' }}>{children}</span>
      </AgentProfilePopup>
    );

  return <MemberProfilePopup userId={id}>{children}</MemberProfilePopup>;
});

MentionProfileTrigger.displayName = 'MentionProfileTrigger';

export default MentionProfileTrigger;
