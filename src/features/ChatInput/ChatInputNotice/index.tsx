'use client';

import { memo } from 'react';

import { ChatInputNoticeContent } from './Content';
import { useChatInputNotices } from './useChatInputNotice';

const ChatInputNotice = memo(() => {
  const notices = useChatInputNotices();

  return <ChatInputNoticeContent notices={notices} />;
});

ChatInputNotice.displayName = 'ChatInputNotice';

export default ChatInputNotice;
