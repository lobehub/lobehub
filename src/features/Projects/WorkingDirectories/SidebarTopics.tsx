import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Filter from '@/features/AgentSidebar/Topic/Filter';
import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import ToggleGroups from '@/features/AgentSidebar/Topic/ToggleGroups';
import ByAgentMode from '@/features/AgentSidebar/Topic/TopicListContent/ByAgentMode';
import ByProjectMode from '@/features/AgentSidebar/Topic/TopicListContent/ByProjectMode';
import ByStatusMode from '@/features/AgentSidebar/Topic/TopicListContent/ByStatusMode';
import ByTimeMode from '@/features/AgentSidebar/Topic/TopicListContent/ByTimeMode';
import FlatMode from '@/features/AgentSidebar/Topic/TopicListContent/FlatMode';
import { TopicListScopeContext } from '@/features/AgentSidebar/Topic/TopicListScope';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectTopics,
} from '@/store/projectWorkingDirectory';

import { openProjectTopicModal } from './StartDirectoryModal';

export function ProjectDirectoryTopics(props: { projectId: string; coordinatorAgentId: string }) {
  const scope = useMemo(() => ({ projectId: props.projectId }), [props.projectId]);
  return (
    <TopicListScopeContext value={scope}>
      <ProjectTopicList {...props} />
    </TopicListScopeContext>
  );
}

function ProjectTopicList({
  projectId,
  coordinatorAgentId,
}: {
  projectId: string;
  coordinatorAgentId: string;
}) {
  const { t } = useTranslation('project');
  const { topicGroupMode } = useAgentTopicGroupMode();
  const request = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const topics = useProjectTopics(projectId);
  const directories = useProjectDirectories(projectId);
  return (
    <Flexbox gap={1} paddingBlock={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={8}>
        <Text fontSize={12} type="secondary" weight={500}>
          {t('topics.title')}
        </Text>
        <Flexbox horizontal align="center" gap={2}>
          <ToggleGroups />
          <Filter />
          <ActionIcon
            aria-label={t('sidebar.newConversation')}
            disabled={!directoriesRequest.hasData || !!directoriesRequest.error}
            icon={PlusIcon}
            size="small"
            title={t('sidebar.newConversation')}
            onClick={() =>
              openProjectTopicModal({
                title: t('sidebar.newConversation'),
                coordinatorAgentId,
                directories,
                projectId,
              })
            }
          />
        </Flexbox>
      </Flexbox>
      {request.error || directoriesRequest.error ? (
        <AsyncError
          error={request.error || directoriesRequest.error}
          onRetry={() => Promise.all([request.revalidate(), directoriesRequest.revalidate()])}
        />
      ) : null}
      {!request.hasData ? (
        <SkeletonList />
      ) : !topics.length && !request.error ? (
        <Text type="secondary">{t('directories.noConversations')}</Text>
      ) : null}
      {topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byStatus' ? (
        <ByStatusMode />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode />
      ) : topicGroupMode === 'byAgent' ? (
        <ByAgentMode />
      ) : (
        <ByTimeMode />
      )}
    </Flexbox>
  );
}
