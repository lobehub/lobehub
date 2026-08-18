'use client';

import { type ComponentType, createContext, use } from 'react';

// Seam that keeps the acceptance viewer free of the conversation universe
// (TopicChatDrawer, task store): hosts that can show the origin conversation
// (the app portal) inject it; hosts that cannot (workbench) leave it null and
// every origin-conversation affordance stays hidden.
export interface OriginTopicPanelProps {
  agentId: string;
  onBack: () => void;
  onCollapse: () => void;
  title: string;
  topicId: string;
}

export interface OriginConversationSlot {
  closeTopicDrawer: () => void;
  openTopicDrawer: (topicId: string, topic?: { agentId?: string; title?: string }) => void;
  TopicPanel: ComponentType<OriginTopicPanelProps>;
}

const OriginConversationContext = createContext<OriginConversationSlot | null>(null);

export const OriginConversationProvider = OriginConversationContext.Provider;

export const useOriginConversation = () => use(OriginConversationContext);
