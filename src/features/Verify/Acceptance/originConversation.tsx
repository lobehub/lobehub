'use client';

import type { ComponentType, ReactNode } from 'react';
import { createContext, use, useMemo, useState } from 'react';

// Host seam: inject TopicPanel (conversation graph). Workbench omits the
// provider so origin-conversation affordances stay hidden. Open state lives
// here — not the task-store topic drawer, which is unmounted on this page.
export interface OriginTopicPanelProps {
  agentId: string;
  onBack: () => void;
  onCollapse: () => void;
  title: string;
  topicId: string;
}

export interface OriginConversationSlot {
  closeTopicDrawer: () => void;
  isOpen: boolean;
  openTopicDrawer: (topicId: string, topic?: { agentId?: string; title?: string }) => void;
  TopicPanel: ComponentType<OriginTopicPanelProps>;
}

export const originTopicPanelProps = ({
  isOpen,
  origin,
  subjectTitle,
}: {
  isOpen: boolean;
  origin?: {
    agent?: { id: string } | null;
    topic?: { id: string; title?: string | null } | null;
  } | null;
  subjectTitle?: string | null;
}): Omit<OriginTopicPanelProps, 'onBack' | 'onCollapse'> | null => {
  if (!isOpen || !origin?.agent?.id || !origin.topic) return null;
  return {
    agentId: origin.agent.id,
    title: origin.topic.title ?? subjectTitle ?? origin.topic.id,
    topicId: origin.topic.id,
  };
};

const OriginConversationContext = createContext<OriginConversationSlot | null>(null);

export const OriginConversationProvider = ({
  TopicPanel,
  children,
}: {
  TopicPanel: ComponentType<OriginTopicPanelProps>;
  children: ReactNode;
}) => {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo<OriginConversationSlot>(
    () => ({
      TopicPanel,
      isOpen,
      closeTopicDrawer: () => setOpen(false),
      openTopicDrawer: () => setOpen(true),
    }),
    [TopicPanel, isOpen],
  );

  return <OriginConversationContext value={value}>{children}</OriginConversationContext>;
};

export const useOriginConversation = () => use(OriginConversationContext);
