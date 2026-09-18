import { Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Avatar,
  Button,
  createModal,
  ModalFooter,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { getProjectConversationPath } from '../Layout/navigation';
import { openAddDirectoryModal } from './AddDirectoryModal';
import { openEnvironmentModal } from './EnvironmentModal';
import { directoryAgentName, useDirectoryAgent } from './useDirectoryAgent';

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
export function ProjectDirectoryTopics({
  projectId,
  coordinatorAgentId,
}: {
  projectId: string;
  coordinatorAgentId: string;
}) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { topicId } = useParams<{ topicId?: string }>();
  const [groupBy, setGroupBy] = useState('status');
  const request = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(projectId);
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const inboxId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const groups = new Map<string, NonNullable<typeof request.data>['data']>();
  const labels = new Map<string, string>();
  for (const topic of request.data?.data ?? []) {
    const name =
      directoryAgentName(
        { name: topic.agentName, title: topic.agentTitle },
        topic.agentId === inboxId,
        t('inbox.title', { ns: 'chat' }),
      ) ?? t('untitledAgent', { ns: 'chat' });
    const key =
      groupBy === 'agent'
        ? topic.agentId!
        : groupBy === 'status'
          ? topic.status || 'active'
          : 'all';
    labels.set(
      key,
      groupBy === 'agent'
        ? name
        : key === 'all'
          ? t('topics.all')
          : t(`topics.status.${key}`, { defaultValue: key }),
    );
    groups.set(key, [...(groups.get(key) ?? []), topic]);
  }
  const order = [
    'waitingForHuman',
    'failed',
    'unread',
    'running',
    'active',
    'scheduled',
    'completed',
    'archived',
  ];
  const entries = [...groups].sort(([a], [b]) =>
    groupBy === 'status' ? order.indexOf(a) - order.indexOf(b) : 0,
  );
  return (
    <Flexbox gap={8} paddingBlock={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={8}>
        <Text weight={600}>{t('topics.title')}</Text>
        <ActionIcon
          aria-label={t('sidebar.newConversation')}
          disabled={directories.isLoading || !!directories.error}
          icon={PlusIcon}
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
      <Select
        aria-label={t('topics.groupBy')}
        value={groupBy}
        options={(['status', 'all', 'agent'] as const).map((value) => ({
          value,
          label: t(`topics.group.${value}`),
        }))}
        onChange={(value) => setGroupBy(value ?? 'status')}
      />
      {request.error || directories.error ? (
        <AsyncError
          error={request.error || directories.error}
          onRetry={() => Promise.all([request.mutate(), directories.mutate()])}
        />
      ) : null}
      {request.isLoading ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : !request.data?.data.length && !request.error ? (
        <Text type="secondary">{t('directories.noConversations')}</Text>
      ) : null}
      {entries.map(([key, topics]) => (
        <Flexbox gap={4} key={key}>
          {groupBy !== 'all' && (
            <Text fontSize={12} style={{ paddingInline: 8 }} type="secondary">
              {labels.get(key)} · {topics.length}
            </Text>
          )}
          {topics.map((topic) => (
            <NavItem
              active={topic.id === topicId}
              key={topic.id}
              title={topic.title || t('directories.untitled')}
              titleColor={cssVar.colorText}
              extra={
                groupBy !== 'status' && (
                  <Text fontSize={12} type="secondary">
                    {t(`topics.status.${topic.status || 'active'}`, {
                      defaultValue: topic.status || 'active',
                    })}
                  </Text>
                )
              }
              slots={{
                titlePrefix: (
                  <Avatar
                    avatar={topic.agentAvatar || topic.agentName || topic.agentTitle || '🤖'}
                    size={20}
                    title={topic.agentName || topic.agentTitle || undefined}
                  />
                ),
              }}
              onClick={() => navigate(getProjectConversationPath(projectId, topic.id))}
            />
          ))}
        </Flexbox>
      ))}
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
