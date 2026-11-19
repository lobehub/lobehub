import type { TaskStatus, WorkListItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';

import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useResourceDeletedPrompt } from '@/features/Work/useResourceDeletedPrompt';
import { useChatStore } from '@/store/chat';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

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

const styles = stylex.create({
  context: {
    flexShrink: 0,
    fontSize: sidebarRow.metaFontSize,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    minHeight: sidebarRow.height,
    paddingInline: sidebarRow.paddingInline,
    borderRadius: sidebarRow.radius,
    fontSize: sidebarRow.textFontSize,
    lineHeight: sidebarRow.textLineHeight,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  icon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: sidebarRow.iconBox,
    height: sidebarRow.textLineHeight,
    color: cssVar.colorTextTertiary,
  },
  title: { minWidth: '0', fontSize: 'inherit', color: 'inherit' },
  toggle: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    color: cssVar.colorTextTertiary,
  },
});

const WorkVersionHistoryCard = memo<{ work: WorkListItem }>(({ work }) => {
  const [expanded, setExpanded] = useState(false);
  const density = useDensityTokens();
  const [openCanvas, openDocument, openFilePreview, openTaskDetail] = useChatStore((s) => [
    s.openCanvas,
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
      case 'canvas': {
        return () => openCanvas(openTarget.canvasId, openTarget.version);
      }
      case 'filePreview': {
        return () => openFilePreview({ fileId: openTarget.fileId });
      }
      case 'task': {
        return resourceDeleted
          ? () => promptResourceDeleted(work)
          : () => openTaskDetail(openTarget.taskId);
      }
    }
  })();

  return (
    <Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={density.gap}
        onClick={() => setExpanded((value) => !value)}
      >
        <span {...stylex.props(styles.toggle)}>
          <ToggleIcon size={12} />
        </span>
        {work.type === 'task' ? (
          <>
            <TaskPriorityTag disableDropdown priority={work.task.priority} size={14} />
            <TaskStatusTag disableDropdown size={14} status={toTaskStatus(work.task.status)} />
          </>
        ) : (
          <span {...stylex.props(styles.icon)}>
            <TypeIcon size={density.iconSize} />
          </span>
        )}
        <Text className={stylex.props(styles.context).className} style={{ flexShrink: 0 }}>
          {label}
        </Text>
        {title && (
          <Text
            ellipsis
            className={stylex.props(styles.title).className}
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
