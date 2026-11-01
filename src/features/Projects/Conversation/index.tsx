'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import ConversationWorkspace from '@/features/Conversation/Workspace';
import NavHeader from '@/features/NavHeader';
import ChatConversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import TerminalPanelToggle from '@/routes/(main)/agent/features/Conversation/Header/TerminalPanelToggle';
import WorkingPanelToggle from '@/routes/(main)/agent/features/Conversation/Header/WorkingPanelToggle';

import ProjectTopicActions from './ProjectTopicActions';
import { useProjectConversation } from './useProjectConversation';

const ProjectConversation = memo(() => {
  const { fallback, getConversationPath, getTopicPath, restageDraft, stage, title, topic } =
    useProjectConversation();

  if (fallback) return fallback;

  return (
    <ConversationWorkspace
      header={
        <NavHeader
          left={
            <Text ellipsis weight={600}>
              {title}
            </Text>
          }
          right={
            <Flexbox horizontal align="center" gap={4}>
              <TerminalPanelToggle />
              <WorkingPanelToggle />
              {topic && <ProjectTopicActions topic={topic} />}
            </Flexbox>
          }
        />
      }
    >
      {stage === 'ready' ? (
        <>
          <ChatHydration getConversationPath={getConversationPath} getTopicPath={getTopicPath} />
          <Flexbox
            flex={1}
            style={{ minHeight: 0, minWidth: 0 }}
            onFocusCapture={restageDraft}
            onPointerDownCapture={restageDraft}
          >
            <ChatConversation />
          </Flexbox>
        </>
      ) : (
        // Not delayed: the header is already on screen, and a blank column
        // reads as the composer blinking out.
        <ConversationSegmentSkeleton />
      )}
    </ConversationWorkspace>
  );
});

ProjectConversation.displayName = 'ProjectConversation';

export default ProjectConversation;
