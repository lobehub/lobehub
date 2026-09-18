import { getWorkingDirSourcePath } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Avatar, Button, createModal, Select, Text, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openCreateProjectModal } from '../CreateProjectModal';
import { getProjectConversationPath } from '../Layout/navigation';
import { openBindDirectoryModal } from './BindDirectoryModal';

function AssociateTopicContent({ topicId, agentId }: { topicId: string; agentId?: string }) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const topic = useChatStore((s) => s.useFetchTopicDetail)(topicId);
  const projects = useProjectStore((s) => s.useFetchProjectList)();
  const [selectedProject, setProject] = useState('');
  const projectId = topic.data?.projectId || selectedProject;
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(
    projectId,
    !!projectId,
  );
  const [directoryId, setDirectory] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const associate = useProjectDirectoryStore((s) => s.associateTopic);
  const source = getWorkingDirSourcePath(
    topic.data?.metadata?.workingDirectoryConfig ?? topic.data?.metadata?.workingDirectory,
  );
  const deviceId =
    topic.data?.metadata?.projectExecution?.deviceId ?? topic.data?.metadata?.boundDeviceId;
  const options = (directories.data?.data ?? []).filter(
    (d) =>
      !source ||
      (d.path.replace(/[\\/]+$/, '') === source.replace(/[\\/]+$/, '') &&
        (!deviceId || d.deviceId === deviceId)),
  );
  const selectedDirectory =
    topic.data?.projectWorkingDirectoryId ||
    directoryId ||
    (source && deviceId && options.length === 1 ? options[0].id : undefined);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await associate({ topicId, projectId, directoryId: selectedDirectory || undefined });
      await useChatStore.getState().refreshTopic();
      close();
      navigate(getProjectConversationPath(projectId, topicId));
    } catch (error) {
      console.error('Failed to associate topic', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={16}>
      <Text>{topic.data?.title}</Text>
      {topic.data?.projectId && (
        <Button
          onClick={() => {
            close();
            navigate(getProjectConversationPath(projectId, topicId));
          }}
        >
          {t('topics.viewProject')}
        </Button>
      )}
      {source && (
        <Text type="secondary">
          {deviceId} · {source}
        </Text>
      )}
      <Select
        aria-label={t('directories.project')}
        disabled={pending || !!topic.data?.projectId}
        placeholder={t('directories.project')}
        value={projectId}
        options={[
          ...(projects.data?.data ?? []).map((p) => ({
            value: p.id,
            label: (
              <Flexbox horizontal align="center" gap={8}>
                <Avatar avatar={p.avatar || '📁'} size={20} />
                {p.name}
              </Flexbox>
            ),
          })),
          { value: '__create__', label: t('directories.createProject') },
        ]}
        onChange={(value) =>
          value === '__create__'
            ? openCreateProjectModal({ onCreated: (p) => setProject(p.id) })
            : (setProject(value ?? ''), setDirectory(''))
        }
      />
      <Select
        aria-label={t('topics.executionContext')}
        disabled={pending || !projectId || !!topic.data?.projectWorkingDirectoryId}
        placeholder={t('topics.executionContext')}
        value={selectedDirectory || '__none__'}
        options={[
          ...(!source ? [{ value: '__none__', label: t('topics.conversationOnly') }] : []),
          ...options.map((d) => ({
            value: d.id,
            label: `${d.environmentName || d.name} · ${d.deviceName || d.deviceId} · ${d.path}`,
          })),
        ]}
        onChange={(value) => setDirectory(value === '__none__' ? '' : (value ?? ''))}
      />
      {source && deviceId && !options.length && projectId && (
        <Button
          onClick={() =>
            openBindDirectoryModal({
              projectId,
              agentId,
              deviceId,
              path: source,
              topicIds: [topicId],
            })
          }
        >
          {t('directories.bind')}
        </Button>
      )}
      {error || topic.error || projects.error || directories.error ? (
        <AsyncError
          description={error instanceof Error ? error.message : undefined}
          error={error || topic.error || projects.error || directories.error}
          onRetry={() =>
            error ? save() : Promise.all([topic.mutate(), projects.mutate(), directories.mutate()])
          }
        />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!projectId || !topic.data || (!!source && !selectedDirectory)}
          loading={pending}
          type="primary"
          onClick={save}
        >
          {t('directories.bind')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
export const openAssociateTopicModal = (topicId: string, agentId?: string) =>
  createModal({
    title: t('directories.bind', { ns: 'project' }),
    content: <AssociateTopicContent agentId={agentId} topicId={topicId} />,
    footer: null,
    width: 520,
  });
