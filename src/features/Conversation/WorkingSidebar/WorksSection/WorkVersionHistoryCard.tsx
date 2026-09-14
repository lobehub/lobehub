import type { TaskStatus, WorkListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';

import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useResourceDeletedPrompt } from '@/features/Work/useResourceDeletedPrompt';
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
  const [expanded, setExpanded] = useState(false);
  const [openDocument, openFilePreview, openTaskDetail] = useChatStore((s) => [
    s.openDocument,
    s.openFilePreview,
    s.openTaskDetail,
  ]);
  const ToggleIcon = expanded ? ChevronDownIcon : ChevronRightIcon;
  const promptResourceDeleted = useResourceDeletedPrompt();
  // The underlying resource (task / document) was deleted outside the tool path
  // — the Work survives as an orphan rendered from its snapshot, and opening the
  // gone resource 404s, so a title click explains that and offers removal.
  const resourceDeleted = work.resourceDeleted;

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
        return resourceDeleted
          ? () => promptResourceDeleted(work)
          : () => openDocument(openTarget.documentId);
      }
      case 'external': {
        // Defense in depth: only ever hand http(s) to shell.openExternal.
        return isSafeExternalUrl(openTarget.url)
          ? () => window.open(openTarget.url, '_blank', 'noopener,noreferrer')
          : undefined;
      }
      case 'filePreview': {
        return () => openFilePreview({ fileId: openTarget.fileId });
      }
      case 'task': {
        return resourceDeleted
          ? () => promptResourceDeleted(work)
          : () => openTaskDetail(openTarget.identifier);
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
