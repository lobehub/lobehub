import { Button, createModal, Flexbox, Select, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCurrentProjectList, useProjectStore } from '@/store/project';

import { getProjectHomePath } from '../Layout/navigation';
import ProjectAvatar from '../ProjectAvatar';
import { RunProgress, RunResult } from './RunStatus';
import { useAssociateTopicsRun } from './useAssociateTopicsRun';

interface FileTopicsToProjectProps {
  /** Called once the group was filed, e.g. to leave multi-select mode. */
  onDone?: () => void;
  topicIds: string[];
}

function FileTopicsToProjectContent({ onDone, topicIds }: FileTopicsToProjectProps) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const projectSync = useProjectStore((s) => s.useFetchProjectList)();
  const projects = useCurrentProjectList();
  const [projectId, setProjectId] = useState<string>();
  const { progress, result, run, running } = useAssociateTopicsRun();

  if (progress) return <RunProgress progress={progress} />;
  if (result && projectId)
    return (
      <Flexbox>
        <RunResult result={result} />
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={close}>{t('moveTopics.close')}</Button>
          {result.movedTopicIds.length > 0 && (
            <Button
              type="primary"
              onClick={() => {
                close();
                navigate(getProjectHomePath(projectId));
              }}
            >
              {t('topics.viewProject')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox gap={16}>
      <Text>{t('moveTopics.fileDesc', { count: topicIds.length })}</Text>
      <Select
        aria-label={t('directories.project')}
        placeholder={t('directories.project')}
        value={projectId}
        options={projects.map((p) => ({
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <ProjectAvatar avatar={p.avatar} id={p.id} name={p.name} />
              {p.name}
            </Flexbox>
          ),
          value: p.id,
        }))}
        onChange={(value) => setProjectId(value ?? undefined)}
      />
      {projectSync.error ? (
        <AsyncError error={projectSync.error} onRetry={() => projectSync.revalidate()} />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!projectId}
          loading={running}
          type="primary"
          onClick={async () => {
            if (!projectId) return;
            const next = await run(projectId, topicIds);
            if (next.movedTopicIds.length) onDone?.();
          }}
        >
          {t('moveTopics.submit', { count: topicIds.length })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openFileTopicsToProjectModal = (props: FileTopicsToProjectProps) =>
  createModal({
    content: <FileTopicsToProjectContent {...props} />,
    footer: null,
    title: t('moveTopics.fileTitle', { ns: 'project' }),
    width: 'min(90%, 480px)',
  });
