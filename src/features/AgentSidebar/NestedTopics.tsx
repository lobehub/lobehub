'use client';

import { ConversationNestedPortal } from '@/features/MessageList';

import Body from './Body';

/**
 * The agent's topic accordion, nested under its row in the Messages
 * conversation list (rail layout) instead of a separate sidebar.
 */
const AgentNestedTopics = () => (
  <ConversationNestedPortal>
    <Body />
  </ConversationNestedPortal>
);

export default AgentNestedTopics;
