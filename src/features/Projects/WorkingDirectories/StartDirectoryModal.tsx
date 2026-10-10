'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  ModalFooter,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  type ProjectDirectory,
  useProjectDirectories,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

import { getProjectConversationPath } from '../Layout/navigation';
import { openAddDirectoryModal } from './AddDirectoryModal';
import { openEnvironmentModal } from './EnvironmentModal';
import { useDirectoryAgent } from './useDirectoryAgent';

export function StartDirectoryContent({
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
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const liveDirectories = useProjectDirectories(projectId);
  const locations = liveDirectories.length ? liveDirectories : directories;
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
