'use client';

import { useTranslation } from 'react-i18next';

import TopicActions from '@/features/AgentSidebar/Topic/List/Item/Actions';

import type { useProjectConversation } from './useProjectConversation';

type ProjectConversationTopic = NonNullable<ReturnType<typeof useProjectConversation>['topic']>;

const ProjectTopicActions = ({ topic }: { topic: ProjectConversationTopic }) => {
  const { t } = useTranslation('project');

  return (
    <TopicActions
      completionLabel={t(topic.status === 'completed' ? 'topics.resume' : 'topics.complete')}
      id={topic.id}
      status={topic.status}
      title={topic.title}
    />
  );
};

export default ProjectTopicActions;
