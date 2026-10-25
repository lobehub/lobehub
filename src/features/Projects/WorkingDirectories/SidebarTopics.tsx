import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Filter from '@/features/AgentSidebar/Topic/Filter';
import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import ToggleGroups from '@/features/AgentSidebar/Topic/ToggleGroups';
import ByAgentMode from '@/features/AgentSidebar/Topic/TopicListContent/ByAgentMode';
import ByDeviceMode from '@/features/AgentSidebar/Topic/TopicListContent/ByDeviceMode';
import ByStatusMode from '@/features/AgentSidebar/Topic/TopicListContent/ByStatusMode';
import ByTimeMode from '@/features/AgentSidebar/Topic/TopicListContent/ByTimeMode';
import FlatMode from '@/features/AgentSidebar/Topic/TopicListContent/FlatMode';
import {
  TopicListFilterContext,
  TopicListRevealContext,
  TopicListScopeContext,
  useTopicListFilter,
} from '@/features/AgentSidebar/Topic/TopicListScope';
import { useOnlyMineTopics, useScopedTopics } from '@/features/AgentSidebar/Topic/useScopedTopics';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useWorkspacePreferenceReady } from '@/hooks/useWorkspacePreferenceReady';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectTopics,
} from '@/store/projectWorkingDirectory';
import { filterTopics, type TopicListFilter } from '@/utils/client/topic';

import { openProjectTopicModal } from './StartDirectoryModal';
import { canStageDraftOn, startProjectTopicDraft } from './startProjectTopicDraft';
import { useAgentFixedDeviceId } from './useAgentFixedDeviceId';
import { useProjectTopicReveal } from './useProjectTopicReveal';

export function ProjectDirectoryTopics(props: { projectId: string; coordinatorAgentId: string }) {
  const scope = useMemo(
    () => ({ coordinatorAgentId: props.coordinatorAgentId, projectId: props.projectId }),
    [props.projectId, props.coordinatorAgentId],
  );
  const reveal = useProjectTopicReveal(props.projectId);
  const [filter, setFilter] = useState<TopicListFilter>({});
  const filterState = useMemo(() => ({ filter, setFilter }), [filter]);
  return (
    <TopicListScopeContext value={scope}>
      <TopicListRevealContext value={reveal}>
        <TopicListFilterContext value={filterState}>
          <ProjectTopicList {...props} />
        </TopicListFilterContext>
      </TopicListRevealContext>
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
  const { t: tTopic } = useTranslation('topic');
  const { topicGroupMode } = useAgentTopicGroupMode();
  const filterState = useTopicListFilter();
  const request = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  // The empty state must follow what the list shows, "only mine" included.
  const topics = useOnlyMineTopics(useProjectTopics(projectId));
  const directories = useProjectDirectories(projectId);
  const { topics: scopedTopics } = useScopedTopics();
  const filter = filterState?.filter;
  const filteredEmpty = useMemo(
    () =>
      !!(filter?.status || filter?.device) &&
      scopedTopics.length > 0 &&
      filterTopics(scopedTopics, filter, { directories }).length === 0,
    [filter, scopedTopics, directories],
  );
  // The rows are filtered client-side by the workspace "only mine" choice, and
  // nothing else on a project route syncs that preference. Hold the list until
  // it is known so the unfiltered rows never paint.
  const isPreferenceLoading = !useWorkspacePreferenceReady();
  const navigate = useWorkspaceAwareNavigate();
  const fixedDeviceId = useAgentFixedDeviceId(coordinatorAgentId);
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
            onClick={() => {
              // Same habit as an agent's "+": a blank conversation on the first
              // directory the coordinator can run in, switchable in the composer before the first
              // send. The modal only remains for a project with none yet.
              const directory = directories.find((d) => canStageDraftOn(d, fixedDeviceId));
              if (directory) {
                startProjectTopicDraft({
                  agentId: coordinatorAgentId,
                  directoryId: directory.id,
                  navigate,
                  projectId,
                });
                return;
              }
              openProjectTopicModal({
                title: t('sidebar.newConversation'),
                coordinatorAgentId,
                directories,
                projectId,
              });
            }}
          />
        </Flexbox>
      </Flexbox>
      {request.error || directoriesRequest.error ? (
        <AsyncError
          error={request.error || directoriesRequest.error}
          onRetry={() => Promise.all([request.revalidate(), directoriesRequest.revalidate()])}
        />
      ) : null}
      {!request.hasData || isPreferenceLoading ? (
        <SkeletonList />
      ) : !topics.length && !request.error ? (
        <Text fontSize={12} style={{ paddingInline: 8 }} type="secondary">
          {t('directories.noConversations')}
        </Text>
      ) : filteredEmpty ? (
        <Flexbox align="flex-start" gap={4} paddingInline={8}>
          <Text type="secondary">{tTopic('filter.emptyFiltered')}</Text>
          <Button size="small" type="text" onClick={() => filterState?.setFilter({})}>
            {tTopic('filter.clear')}
          </Button>
        </Flexbox>
      ) : null}
      {isPreferenceLoading ? null : topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byStatus' ? (
        <ByStatusMode />
      ) : topicGroupMode === 'byAgent' ? (
        <ByAgentMode />
      ) : topicGroupMode === 'byDevice' ? (
        <ByDeviceMode />
      ) : (
        <ByTimeMode />
      )}
    </Flexbox>
  );
}
