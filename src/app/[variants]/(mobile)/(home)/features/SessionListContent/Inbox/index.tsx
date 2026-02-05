import { memo } from 'react';
import { Link } from 'react-router-dom';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SESSION_CHAT_URL } from '@/const/url';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import ListItem from '../ListItem';

const Inbox = memo(() => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const isInboxActive = useSessionStore(sessionSelectors.isInboxSession);
  const navigateToAgent = useNavigateToAgent();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  return (
    <Link
      aria-label={'Lobe AI'}
      to={SESSION_CHAT_URL(inboxAgentId, mobile)}
      onClick={(e) => {
        e.preventDefault();
        navigateToAgent(inboxAgentId);
      }}
    >
      <ListItem
        active={isInboxActive}
        avatar={DEFAULT_INBOX_AVATAR}
        key={'inbox'}
        title={'Lobe AI'}
        styles={{
          container: {
            gap: 12,
          },
          content: {
            gap: 6,
            maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
          },
        }}
      />
    </Link>
  );
});

export default Inbox;
