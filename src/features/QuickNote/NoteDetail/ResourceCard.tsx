'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { FileText, Link2, ListTodo, MessageSquareText, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PortalResourceCard from '@/features/Conversation/components/PortalResourceCard';
import { openDocumentModal } from '@/features/DocumentModal/loader';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import type { QuickNoteResource } from '@/services/quickNote';
import { useTaskStore } from '@/store/task';

import { resolveQuickNoteResourceOpenTarget } from './resolveResourceOpenTarget';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    height: 56px;
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

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

interface ResourceCardProps {
  resource: QuickNoteResource;
}

/**
 * Renders one typed Quick Note context link with its product-native open behavior.
 *
 * Use when:
 * - A Quick Note shows an Agent-selected Document, Topic, Conversation, Page, or Task.
 * - The surrounding surface should stay open while the referenced object is inspected.
 *
 * Expects:
 * - Topic-like resources include their owning `agentId` before they become interactive.
 * - Unsupported resource families remain visible without a misleading click affordance.
 *
 * Returns:
 * - A compact resource card that opens a modal, drawer, or canonical route when supported.
 */
const ResourceCard = memo<ResourceCardProps>(({ resource }) => {
  const { t } = useTranslation('note');
  const navigate = useStableNavigate();
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const title = resource.label?.trim() || resource.resourceId;
  const typeLabel = t(`agentic.resources.type.${resource.resourceType}` as never);
  const ResourceIcon = getResourceIcon(resource.resourceType);
  const openTarget = resolveQuickNoteResourceOpenTarget(resource);

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

  return (
    <PortalResourceCard
      className={styles.card}
      description={typeLabel}
      icon={<Icon className={styles.icon} icon={ResourceIcon} size={24} />}
      title={title}
      tooltip={openTarget ? t('agentic.resources.openHint', { title }) : undefined}
      onOpen={openTarget ? handleOpen : undefined}
    />
  );
});

ResourceCard.displayName = 'QuickNoteResourceCard';

export default ResourceCard;
