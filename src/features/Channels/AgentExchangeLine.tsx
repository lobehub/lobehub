import type { ChannelPublicMessage } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { exchangeAgentOf, exchangeLinkOf } from './agentExchange';
import { styles } from './styles';

/**
 * "Messages from <Agent>", as a system line above an Agent's report of what it concluded after
 * asking another Agent in their conversation. The exchange itself stays in that conversation; the
 * line opens it.
 */
export function AgentExchangeLine({ message }: { message: ChannelPublicMessage }) {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const agent = exchangeAgentOf(message);
  const link = exchangeLinkOf(message);
  if (!agent) return null;
  return (
    <div role="note" {...stylex.props(styles.event)}>
      <Trans
        i18nKey={'events.agentExchange'}
        ns="channel"
        components={{
          agent: (
            <AgentProfilePopup
              agent={{ avatar: agent.avatar ?? undefined, title: agent.name }}
              agentId={agent.agentId}
              trigger={'hover'}
            >
              <span {...stylex.props(styles.eventMember, styles.eventMemberAgent)}>
                <AgentAvatar
                  agentId={agent.agentId}
                  avatar={agent.avatar ?? undefined}
                  name={agent.name}
                  shape={'circle'}
                  size={18}
                />
                <span {...stylex.props(styles.eventMemberName)}>{agent.name}</span>
              </span>
            </AgentProfilePopup>
          ),
        }}
      />
      {/* Only the person who asked is in the conversation between the Agents. */}
      {link && (
        <button
          type="button"
          {...stylex.props(styles.eventAction)}
          onClick={() => navigate(link)}
        >
          {t('events.agentExchangeOpen')}
          <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}
