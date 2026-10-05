import { getWorkingDirSourcePath } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  Alert,
  Avatar,
  Button,
  createModal,
  Select,
  Switch,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openCreateProjectModal } from '../CreateProjectModal';
import { getProjectConversationPath } from '../Layout/navigation';
import { openBindDirectoryModal } from './BindDirectoryModal';

function AssociateTopicContent({ topicId, agentId }: { topicId: string; agentId?: string }) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const topicSync = useChatStore((s) => s.useFetchTopicDetail)(topicId);
  const topic = useChatStore((s) => s.topicDetailMap?.[topicId]);
  const projectSync = useProjectStore((s) => s.useFetchProjectList)();
  const projects = useCurrentProjectList();
  const [selectedProject, setProject] = useState('');
  const projectId = topic?.projectId || selectedProject;
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(
    projectId,
    !!projectId,
  );
  const [directoryId, setDirectory] = useState('');
  const [includeDirectory, setIncludeDirectory] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const associate = useProjectDirectoryStore((s) => s.associateTopic);
  const source = getWorkingDirSourcePath(
    topic?.metadata?.workingDirectoryConfig ?? topic?.metadata?.workingDirectory,
  );
  const deviceId = topic?.metadata?.boundDeviceId;
  const options = (directories.data?.data ?? []).filter(
    (d) =>
      !source ||
      (d.path.replace(/[\\/]+$/, '') === source.replace(/[\\/]+$/, '') &&
        (!deviceId || d.deviceId === deviceId)),
  );
  const selectedDirectory =
    topic?.projectWorkingDirectoryId ||
    directoryId ||
    (source && deviceId && options.length === 1 ? options[0].id : undefined);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await associate({
        topicId,
        projectId,
        directoryId:
          source || topic?.projectWorkingDirectoryId || includeDirectory
            ? selectedDirectory || undefined
            : undefined,
      });
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
      <Text>{topic?.title}</Text>
      {topic?.projectId && (
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
        disabled={pending || !!topic?.projectId}
        placeholder={t('directories.project')}
        value={projectId}
        options={[
          ...projects.map((p) => ({
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
      {!source && !topic?.projectWorkingDirectoryId && (
        <Flexbox horizontal align="center" justify="space-between">
          <label htmlFor="associate-topic-directory">{t('topics.addLocation')}</label>
          <Switch
            checked={includeDirectory}
            disabled={pending || !projectId}
            id="associate-topic-directory"
            onChange={setIncludeDirectory}
          />
        </Flexbox>
      )}
      {(source || topic?.projectWorkingDirectoryId || includeDirectory) && (
        <Select
          aria-label={t('topics.executionContext')}
          disabled={pending || !projectId || !!topic?.projectWorkingDirectoryId}
          placeholder={t('topics.chooseLocation')}
          value={selectedDirectory}
          options={options.map((d) => ({
            value: d.id,
            label: `${d.environmentName || d.name} · ${d.deviceName || d.deviceId} · ${d.path}`,
          }))}
          onChange={(value) => setDirectory(value ?? '')}
        />
      )}
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
      {error ? (
        <Alert
          showIcon
          description={error instanceof Error ? error.message : undefined}
          title={t('topics.associateFailed')}
          type="error"
        />
      ) : null}
      {topicSync.error || projectSync.error || directories.error ? (
        <AsyncError
          error={topicSync.error || projectSync.error || directories.error}
          onRetry={() =>
            Promise.all([topicSync.revalidate(), projectSync.revalidate(), directories.mutate()])
          }
        />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!projectId || !topic || ((!!source || includeDirectory) && !selectedDirectory)}
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
