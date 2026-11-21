import { ConversationChatItem } from 'verification:component';

import MessageSelectionWrapper from '@/features/Conversation/MessageForward/MessageSelectionWrapper';

const actions = (popupOpen: boolean) => (
  <>
    <button type="button">Copy</button>
    <button data-popup-open={popupOpen ? '' : undefined} type="button">
      More
    </button>
  </>
);

export const Fixture = ({ variant }: { variant: string }) => {
  const isUser = variant.includes('user');
  const item = (
    <ConversationChatItem
      showTitle
      actions={actions(variant === 'popup-open')}
      avatar={{ avatar: 'A', title: 'Fixture agent' }}
      id={'msg_fixture'}
      message={'A message body long enough to wrap across the fixture width.'}
      placement={isUser ? 'right' : 'left'}
      time={Date.UTC(2026, 10, 5, 10)}
      {...(variant === 'locate-highlight' ? { 'data-message-locate-highlight': '' } : {})}
    />
  );
  if (!variant.startsWith('selection')) return item;
  return (
    <MessageSelectionWrapper id={'msg_fixture'} role={isUser ? 'user' : 'assistant'}>
      {item}
    </MessageSelectionWrapper>
  );
};
