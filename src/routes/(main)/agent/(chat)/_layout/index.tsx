'use client';

import { Outlet } from 'react-router';

import { RenderProfiler } from '@/components/RenderProfiler';
import ConversationWorkspace from '@/features/Conversation/Workspace';
import ChatHeader from '@/routes/(main)/agent/features/Conversation/Header';

const ChatLayout = () => (
  <RenderProfiler region={'conversation'}>
    <ConversationWorkspace header={<ChatHeader />}>
      <Outlet />
    </ConversationWorkspace>
  </RenderProfiler>
);

export default ChatLayout;
