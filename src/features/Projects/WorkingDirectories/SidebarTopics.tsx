import { Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  ModalFooter,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Filter from '@/features/AgentSidebar/Topic/Filter';
import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import ToggleGroups from '@/features/AgentSidebar/Topic/ToggleGroups';
import ByProjectMode from '@/features/AgentSidebar/Topic/TopicListContent/ByProjectMode';
import ByStatusMode from '@/features/AgentSidebar/Topic/TopicListContent/ByStatusMode';
import ByTimeMode from '@/features/AgentSidebar/Topic/TopicListContent/ByTimeMode';
import FlatMode from '@/features/AgentSidebar/Topic/TopicListContent/FlatMode';
import { TopicListScopeContext } from '@/features/AgentSidebar/Topic/TopicListScope';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { getProjectConversationPath } from '../Layout/navigation';
import { openAddDirectoryModal } from './AddDirectoryModal';
import { openEnvironmentModal } from './EnvironmentModal';
import { useDirectoryAgent } from './useDirectoryAgent';

function StartDirectoryContent({
  directories,
  coordinatorAgentId,
  projectId,
  initialDirectoryId,
}: {
  directories: ProjectDirectory[];
  coordinatorAgentId: string;
  projectId: string;
  initialDirectoryId?: string;
}) {
  const [directoryId, setDirectoryId] = useState(
    initialDirectoryId ?? (directories.length === 1 ? directories[0].id : ''),
  );
  const liveDirectories = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const locations = liveDirectories.data?.data ?? directories;
  const directory = locations.find((d) => d.id === directoryId);
  const attachEnvironment = useProjectDirectoryStore((s) => s.attachEnvironment);
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const { agentId, agentName, setAgentId } = useDirectoryAgent(coordinatorAgentId);
  const startTopic = useProjectDirectoryStore((s) => s.startTopic);
  const createTopic = useProjectDirectoryStore((s) => s.createProjectTopic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const start = async () => {
    setPending(true);
    setError(undefined);
    try {
      const topic = directory
        ? await startTopic(directory.id, agentId, t('directories.untitled'))
        : await createTopic({ projectId, agentId, title: t('directories.untitled') });
      close();
      navigate(getProjectConversationPath(projectId, topic.id));
    } catch (error) {
      console.error('Failed to start directory work', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Text>{t('topics.executionContext')}</Text>
        <Select
          aria-label={t('topics.executionContext')}
          disabled={pending}
          value={directoryId || '__none__'}
          options={[
            { value: '__none__', label: t('topics.conversationOnly') },
            ...locations
              .filter((d) => d.instanceId)
              .map((d) => ({
                value: d.id,
                label: `${d.environmentName || d.name} · ${d.deviceName || d.deviceId} · ${d.path}`,
              })),
          ]}
          onChange={(id) => setDirectoryId(id === '__none__' ? '' : (id ?? ''))}
        />
        {!locations.length && (
          <Button
            onClick={() =>
              openEnvironmentModal({
                onSaved: async (env) => {
                  await attachEnvironment(projectId, env.id);
                  openAddDirectoryModal(projectId, env.id);
                },
              })
            }
          >
            {t('settings.addDirectory')}
          </Button>
        )}
        <AssigneeAgentSelector
          currentAgentId={agentId}
          disabled={pending}
          onChange={(id) => id && setAgentId(id)}
        >
          <span>{agentName || t('directories.coordinator')}</span>
        </AssigneeAgentSelector>
        {error ? (
          <AsyncError
            description={error instanceof Error ? error.message : undefined}
            error={error}
            onRetry={start}
          />
        ) : null}
      </Flexbox>
      <ModalFooter>
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button loading={pending} type="primary" onClick={start}>
          {t('directories.start')}
        </Button>
      </ModalFooter>
    </>
  );
}
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
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
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
            disabled={directories.isLoading || !!directories.error}
            icon={PlusIcon}
            size="small"
            title={t('sidebar.newConversation')}
            onClick={() =>
              createModal({
                title: t('sidebar.newConversation'),
                content: (
                  <StartDirectoryContent
                    coordinatorAgentId={coordinatorAgentId}
                    directories={directories.data?.data ?? []}
                    projectId={projectId}
                  />
                ),
                footer: null,
                width: 520,
              })
            }
          />
        </Flexbox>
      </Flexbox>
      {request.error || directories.error ? (
        <AsyncError
          error={request.error || directories.error}
          onRetry={() => Promise.all([request.mutate(), directories.mutate()])}
        />
      ) : null}
      {request.isLoading ? (
        <SkeletonList />
      ) : !request.data?.data.length && !request.error ? (
        <Text type="secondary">{t('directories.noConversations')}</Text>
      ) : null}
      {topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byStatus' ? (
        <ByStatusMode />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode />
      ) : (
        <ByTimeMode />
      )}
    </Flexbox>
  );
}

export function openProjectTopicModal(options: {
  projectId: string;
  coordinatorAgentId: string;
  directories: ProjectDirectory[];
  initialDirectoryId?: string;
  title: string;
}) {
  return createModal({
    title: options.title,
    content: <StartDirectoryContent {...options} />,
    footer: null,
    width: 520,
  });
}
