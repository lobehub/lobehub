import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Button,
  cx,
  Flexbox,
  Text,
} from '@lobehub/ui';
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
  type TopicListScopeAgent,
  TopicListScopeContext,
  useTopicListFilter,
} from '@/features/AgentSidebar/Topic/TopicListScope';
import { useOnlyMineTopics, useScopedTopics } from '@/features/AgentSidebar/Topic/useScopedTopics';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectTopics,
} from '@/store/projectWorkingDirectory';
import { filterTopics, type TopicListFilter } from '@/utils/client/topic';

import { canStageDraftOn } from './startProjectTopicDraft';
import { useAgentFixedDeviceId } from './useAgentFixedDeviceId';
import { useProjectTopicReveal } from './useProjectTopicReveal';
import { useStartProjectTopic } from './useStartProjectTopic';

interface ProjectDirectoryTopicsProps {
  /** The main agent's display meta, for its group before the project has any topic. */
  coordinatorAgent?: TopicListScopeAgent;
  coordinatorAgentId: string;
  /** The accordion item value; the parent `AccordionRoot` owns the expanded state. */
  itemKey: string;
  projectId: string;
}

export function ProjectDirectoryTopics(props: ProjectDirectoryTopicsProps) {
  const scope = useMemo(
    () => ({
      coordinatorAgent: props.coordinatorAgent,
      coordinatorAgentId: props.coordinatorAgentId,
      projectId: props.projectId,
    }),
    [props.projectId, props.coordinatorAgentId, props.coordinatorAgent],
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

function ProjectTopicList({ projectId, coordinatorAgentId, itemKey }: ProjectDirectoryTopicsProps) {
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
  const startTopic = useStartProjectTopic(projectId);
  const fixedDeviceId = useAgentFixedDeviceId(coordinatorAgentId);
  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Text ellipsis fontSize={12} type="secondary" weight={500}>
            {t('topics.title')}
          </Text>
        </AccordionTrigger>
        <Flexbox
          horizontal
          align="center"
          gap={2}
          className={cx(
            'accordion-action',
            accordionStyles.action,
            accordionStyles.actionBorderless,
          )}
        >
          <ToggleGroups />
          <Filter />
          <ActionIcon
            aria-label={t('sidebar.newConversation')}
            disabled={!directoriesRequest.hasData || !!directoriesRequest.error}
            icon={PlusIcon}
            size="small"
            title={t('sidebar.newConversation')}
            onClick={() =>
              // Same habit as an agent's "+": straight into the coordinator's
              // conversation, on the first directory it can run in when there is one.
              void startTopic({
                agentId: coordinatorAgentId,
                directoryId: directories.find((d) => canStageDraftOn(d, fixedDeviceId))?.id,
              })
            }
          />
        </Flexbox>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {request.error || directoriesRequest.error ? (
            <AsyncError
              error={request.error || directoriesRequest.error}
              onRetry={() => Promise.all([request.revalidate(), directoriesRequest.revalidate()])}
            />
          ) : null}
          {!request.hasData ? (
            <SkeletonList />
          ) : !topics.length && !request.error && topicGroupMode !== 'byAgent' ? (
            // By agent, the main agent's empty group offers the first topic instead.
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
          {topicGroupMode === 'flat' ? (
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
      </AccordionPanel>
    </AccordionItem>
  );
}
