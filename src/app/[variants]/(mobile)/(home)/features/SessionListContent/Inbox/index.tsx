import { memo } from 'react';
import { Link } from 'react-router-dom';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { INBOX_SESSION_ID } from '@/const/session';
import { SESSION_CHAT_URL } from '@/const/url';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { getChatStoreState, useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';

import ListItem from '../ListItem';

const Inbox = memo(() => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const activeId = useSessionStore((s) => s.activeId);
  const navigateToAgent = useNavigateToAgent();

  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);

  return (
    <Link
      aria-label={'Lobe AI'}
      onClick={async (e) => {
        e.preventDefault();
        if (activeId === INBOX_SESSION_ID && !mobile) {
          // If user tap the inbox again, open a new topic.
          // Only for desktop.
          const inboxMessages = chatSelectors.inboxActiveTopicMessages(getChatStoreState());
          if (inboxMessages.length > 0) {
            await openNewTopicOrSaveTopic();
          }
        } else {
          navigateToAgent(INBOX_SESSION_ID);
        }
      }}
      to={SESSION_CHAT_URL(INBOX_SESSION_ID, mobile)}
    >
      <ListItem
        active={activeId === INBOX_SESSION_ID}
        avatar={DEFAULT_INBOX_AVATAR}
        key={INBOX_SESSION_ID}
        styles={{
          container: {
            gap: 12,
          },
          content: {
            gap: 6,
            maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
          },
        }}
        title={'Lobe AI'}
      />
    </Link>
  );
});

export default Inbox;
