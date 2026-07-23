import type { TaskStatus, WorkListItem } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useChatStore } from '@/store/chat';

import VersionList from './VersionList';

const TASK_STATUS_SET = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
]);

const toTaskStatus = (status?: string | null): TaskStatus =>
  status && TASK_STATUS_SET.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

const styles = createStaticStyles(({ css, cssVar }) => ({
  context: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    cursor: pointer;
    user-select: none;
    padding-block: 10px;
    padding-inline: 8px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  toggle: css`
    flex-shrink: 0;
  `,
  workCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const WorkVersionHistoryCard = memo<{ work: WorkListItem }>(({ work }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const [openDocument, openTaskDetail] = useChatStore((s) => [s.openDocument, s.openTaskDetail]);
  const ToggleIcon = expanded ? ChevronDownIcon : ChevronRightIcon;
  // The underlying task was deleted outside the tool path — the Work survives as
  // an orphan rendered from its snapshot, and opening the (gone) task detail 404s.
  const taskDeleted = work.type === 'task' && work.taskDeleted;

  const descriptor = getWorkTypeDescriptor(work);
  const label = descriptor.getIdentifier(work) ?? work.resourceId;
  const TypeIcon = descriptor.getIcon(work);
  const title = descriptor.getTitle(work)?.trim();
  const openTarget = descriptor.getOpenTarget(work);

  // Mirrors WorkSummaryCard: external skill rows (linear/github) without a URL
  // get no title click affordance (openTarget is null) — the click falls to the
  // expand toggle. The history card opens documents without an agentDocumentId.
  const handleTitleClick = (() => {
    if (!openTarget) return undefined;
    switch (openTarget.kind) {
      case 'document': {
        return () => openDocument(openTarget.documentId);
      }
      case 'external': {
        // Defense in depth: only ever hand http(s) to shell.openExternal.
        return isSafeExternalUrl(openTarget.url)
          ? () => window.open(openTarget.url, '_blank', 'noopener,noreferrer')
          : undefined;
      }
      case 'task': {
        return taskDeleted ? undefined : () => openTaskDetail(openTarget.identifier);
      }
    }
  })();

  return (
    <Flexbox className={styles.workCard}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={8}
        onClick={() => setExpanded((value) => !value)}
      >
        <ToggleIcon className={styles.toggle} size={16} />
        {work.type === 'task' ? (
          <>
            <TaskPriorityTag disableDropdown priority={work.task.priority} size={14} />
            <TaskStatusTag disableDropdown size={14} status={toTaskStatus(work.task.status)} />
          </>
        ) : (
          <TypeIcon className={styles.context} size={16} />
        )}
        <Text className={styles.context} style={{ flexShrink: 0 }}>
          {label}
        </Text>
        {taskDeleted && (
          <Tag color={'warning'} icon={<Trash2Icon size={12} />} size={'small'}>
            {t('workingPanel.works.taskDeleted')}
          </Tag>
        )}
        {title && (
          <Text
            ellipsis
            className={styles.title}
            onClick={
              handleTitleClick &&
              ((event) => {
                event.stopPropagation();
                handleTitleClick();
              })
            }
          >
            {title}
          </Text>
        )}
      </Flexbox>
      {expanded && <VersionList workId={work.id} />}
    </Flexbox>
  );
});

WorkVersionHistoryCard.displayName = 'WorkVersionHistoryCard';

export default WorkVersionHistoryCard;
