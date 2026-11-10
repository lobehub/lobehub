import type { TaskStatus } from '@lobechat/types';
import { Alert, Button, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import { TaskDetailSkeleton } from '@/features/AgentTasks';
import { STATUS_META } from '@/features/AgentTasks/features/taskStatusMeta';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';

import { getTaskDetailPagePath } from './url';
import { FOREIGN_TASK_NOT_FOUND, useForeignTaskDetail } from './useForeignTaskDetail';
import { useOpenForeignTaskPage } from './useOpenForeignTaskPage';

/**
 * A task from another workspace, shown beside the conversation without moving
 * the page into that workspace. Every editor of the full detail reads and writes
 * the ACTIVE scope's task store, so this view stays read-only and hands editing
 * to the task's own page.
 */
const ForeignTaskDetail = memo(() => {
  const { t } = useTranslation('chat');
  const openTaskPage = useOpenForeignTaskPage();
  const workspaces = useWorkspaces();
  const { data: task, error, isLoading, mutate, taskId, workspace } = useForeignTaskDetail();

  if (!taskId || !workspace) return null;

  const workspaceName = workspaces.find((item) => item.id === workspace.id)?.name || workspace.slug;

  if (error && !task) {
    if (normalizeAsyncError(error).code === FOREIGN_TASK_NOT_FOUND)
      return (
        <NotFound desc={t('taskDetail.notFound.desc')} title={t('taskDetail.notFound.title')} />
      );

    return <AsyncError error={error} variant={'page'} onRetry={() => mutate()} />;
  }

  if (isLoading || !task) return <TaskDetailSkeleton chrome={'body'} />;

  const status = STATUS_META[task.status as TaskStatus] ?? STATUS_META.backlog;
  const pagePath = getTaskDetailPagePath({
    agentId: task.agentId ?? undefined,
    identifier: task.identifier,
    title: task.name,
    workspaceSlug: workspace.slug,
  });
  const openInWorkspace = () => pagePath && openTaskPage(pagePath);

  return (
    <Flexbox gap={20} paddingBlock={16} style={{ paddingBottom: 120 }}>
      <Alert
        showIcon
        title={t('taskDetail.foreignWorkspace.notice', { workspace: workspaceName })}
        type={'info'}
        action={
          <Button size={'small'} onClick={openInWorkspace}>
            {t('taskDetail.foreignWorkspace.open', { workspace: workspaceName })}
          </Button>
        }
      />
      <Flexbox gap={8}>
        <Text fontSize={20} weight={600}>
          {task.name || task.identifier}
        </Text>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={status.color} icon={status.icon} size={14} />
          <Text fontSize={13} type={'secondary'}>
            {t(`taskDetail.${status.labelKey}`, { defaultValue: status.label })}
          </Text>
        </Flexbox>
      </Flexbox>
      {task.description && <Text type={'secondary'}>{task.description}</Text>}
      {task.instruction && (
        <Flexbox gap={8}>
          <Text weight={500}>{t('taskDetail.instruction')}</Text>
          <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
            {task.instruction}
          </Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

ForeignTaskDetail.displayName = 'ForeignTaskDetail';

export default ForeignTaskDetail;
