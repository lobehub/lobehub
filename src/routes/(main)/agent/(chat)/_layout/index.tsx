'use client';

import { Outlet } from 'react-router';

import ConversationWorkspace from '@/features/Conversation/Workspace';
import ChatHeader from '@/routes/(main)/agent/features/Conversation/Header';

const ChatLayout = () => (
  <ConversationWorkspace header={<ChatHeader />}>
    <Outlet />
  </ConversationWorkspace>
);

export default ChatLayout;
