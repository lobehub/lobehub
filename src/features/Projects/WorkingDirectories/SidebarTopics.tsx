import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
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

import AsyncError from '@/components/AsyncError';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { directoryAgentName, useDirectoryAgent } from './useDirectoryAgent';

function StartDirectoryContent({
  directories,
  coordinatorAgentId,
}: {
  directories: ProjectDirectory[];
  coordinatorAgentId: string;
}) {
  const [directoryId, setDirectoryId] = useState(directories[0].id);
  const directory = directories.find((d) => d.id === directoryId)!;
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const { agentId, agentName, setAgentId } = useDirectoryAgent(coordinatorAgentId);
  const startTopic = useProjectDirectoryStore((s) => s.startTopic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const start = async () => {
    setPending(true);
    setError(undefined);
    try {
      const topic = await startTopic(directory.id, agentId, t('directories.untitled'));
      close();
      navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
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
        {directories.length > 1 ? (
          <Select
            aria-label={t('directories.device')}
            value={directoryId}
            options={directories.map((d) => ({
              value: d.id,
              label: `${d.deviceName || d.deviceId} · ${d.path}`,
            }))}
            onChange={(id) => id && setDirectoryId(id)}
          />
        ) : (
          <Text type="secondary">
            {directory.deviceName || directory.deviceId} · {directory.path}
          </Text>
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
function DirectoryTopics({
  directories,
  name,
  coordinatorAgentId,
}: {
  directories: ProjectDirectory[];
  name: string;
  coordinatorAgentId: string;
}) {
  const directory = directories[0];
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const request = useProjectDirectoryStore((s) => s.useFetchEnvironmentTopics)(
    directories.map((d) => d.id),
  );
  const inboxId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentLabel = (topic: {
    agentId: string | null;
    agentName: string | null;
    agentTitle: string | null;
  }) =>
    directoryAgentName(
      { name: topic.agentName, title: topic.agentTitle },
      topic.agentId === inboxId,
      t('inbox.title', { ns: 'chat' }),
    ) ?? t('untitledAgent', { ns: 'chat' });
  return (
    <Flexbox gap={4} paddingBlock={8}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={8}>
        <Text ellipsis fontSize={12} type="secondary">
          {name}
        </Text>
        <ActionIcon
          aria-label={t('directories.start')}
          disabled={!directory?.instanceId}
          icon={PlusIcon}
          size="small"
          title={t('directories.start')}
          onClick={() =>
            createModal({
              title: t('directories.start'),
              content: (
                <StartDirectoryContent
                  coordinatorAgentId={coordinatorAgentId}
                  directories={directories}
                />
              ),
              footer: null,
              styles: { content: { padding: 0 } },
              width: 440,
            })
          }
        />
      </Flexbox>
      {request.error ? (
        <AsyncError error={request.error} variant="inline" onRetry={request.mutate} />
      ) : request.isLoading ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : request.data?.data.length ? (
        request.data.data.map((topic) => (
          <NavItem
            key={topic.id}
            title={topic.title || t('directories.untitled')}
            titleColor={cssVar.colorText}
            slots={{
              titlePrefix: (
                <Avatar
                  avatar={topic.agentAvatar || agentLabel(topic)}
                  size={20}
                  title={agentLabel(topic)}
                />
              ),
            }}
            onClick={() => topic.agentId && navigate(AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id))}
          />
        ))
      ) : (
        <Text fontSize={12} style={{ paddingInline: 8 }} type="secondary">
          {t('directories.noConversations')}
        </Text>
      )}
    </Flexbox>
  );
}
export function ProjectDirectoryTopics({
  projectId,
  coordinatorAgentId,
}: {
  projectId: string;
  coordinatorAgentId: string;
}) {
  const request = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const environments = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  return (
    <Flexbox gap={4}>
      {request.error || environments.error ? (
        <AsyncError
          error={request.error || environments.error}
          variant="inline"
          onRetry={() => Promise.all([request.mutate(), environments.mutate()])}
        />
      ) : (
        environments.data?.data.map((environment) => {
          const directories = (request.data?.data ?? []).filter(
            (d) => d.environmentId === environment.id,
          );
          return (
            <DirectoryTopics
              coordinatorAgentId={coordinatorAgentId}
              directories={directories}
              key={environment.id}
              name={environment.name}
            />
          );
        })
      )}
      {!request.error &&
        request.data?.data
          .filter((d) => !d.environmentId)
          .map((directory) => (
            <DirectoryTopics
              coordinatorAgentId={coordinatorAgentId}
              directories={[directory]}
              key={directory.id}
              name={directory.name}
            />
          ))}
    </Flexbox>
  );
}
