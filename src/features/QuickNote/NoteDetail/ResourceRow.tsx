'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import { FileText, Link2, ListTodo, MessageSquareText, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openDocumentModal } from '@/features/DocumentModal/loader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { QuickNoteResource } from '@/services/quickNote';
import { useTaskStore } from '@/store/task';

import { formatNoteDate } from '../utils';
import { resolveQuickNoteResourceOpenTarget } from './resolveResourceOpenTarget';

const getResourceIcon = (type: QuickNoteResource['resourceType']): LucideIcon => {
  switch (type) {
    case 'document':
    case 'page': {
      return FileText;
    }
    case 'conversation':
    case 'topic': {
      return MessagesSquare;
    }
    case 'task': {
      return ListTodo;
    }
    case 'message':
    case 'thread':
    case 'turn': {
      return MessageSquareText;
    }
    default: {
      return Link2;
    }
  }
};

const resolveTrailingText = (resource: QuickNoteResource, t: TFunction<'note'>): string => {
  switch (resource.resourceType) {
    case 'task': {
      return resource.taskStatus
        ? t(`taskDetail.status.${resource.taskStatus}` as never, { ns: 'chat' })
        : '';
    }
    case 'topic':
    case 'conversation': {
      return formatNoteDate(resource.createdAt);
    }
    case 'page':
    case 'document': {
      return t('ai.group.pages');
    }
    default: {
      return resource.resourceType;
    }
  }
};

const ResourceRow = memo<{ resource: QuickNoteResource }>(({ resource }) => {
  const { t } = useTranslation('note');
  const navigate = useWorkspaceAwareNavigate();
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const title = resource.label?.trim() || resource.resourceId;
  const ResourceIcon = getResourceIcon(resource.resourceType);
  const openTarget = resolveQuickNoteResourceOpenTarget(resource);
  const trailingText = resolveTrailingText(resource, t);

  const handleOpen = () => {
    switch (openTarget?.kind) {
      case 'document': {
        void openDocumentModal(openTarget.documentId);
        return;
      }
      case 'topic': {
        openTopicDrawer(openTarget.topicId, { agentId: openTarget.agentId, title });
        return;
      }
      case 'task': {
        navigate(`/task/${encodeURIComponent(openTarget.taskId)}`);
      }
    }
  };

  const row = (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      height={28}
      role={openTarget ? 'button' : undefined}
      style={{ cursor: openTarget ? 'pointer' : 'default' }}
      onClick={openTarget ? handleOpen : undefined}
    >
      <Icon icon={ResourceIcon} size={14} style={{ color: cssVar.colorTextSecondary }} />
      <Text ellipsis fontSize={13} style={{ flex: 1 }}>
        {title}
      </Text>
      {trailingText && (
        <Text color={cssVar.colorTextTertiary} fontSize={11}>
          {trailingText}
        </Text>
      )}
    </Flexbox>
  );

  if (!openTarget) return row;

  return <Tooltip title={t('agentic.resources.openHint', { title })}>{row}</Tooltip>;
});

ResourceRow.displayName = 'QuickNoteResourceRow';

export default ResourceRow;
