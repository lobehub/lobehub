'use client';

import { ContextMenuTrigger, type DropdownItem, Flexbox, Tooltip } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties, MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type ImageGenerationTopic } from '@/types/generation';

import { useGenerationTopicContext } from '../StoreContext';

const styles = stylex.create({
  gridItem: {
    cursor: 'pointer',
    position: 'relative',
    aspectRatio: 1,
    width: '100%',
    height: 'auto',
    borderRadius: '4px',
    objectFit: 'cover',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    transition: `border 0.15s ${cssVar.motionEaseInOut}`,
  },
  gridItemActive: {
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgLayout,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimary}`,
  },
  gridItemImg: { aspectRatio: 1, width: '100%' },
});

interface TopicItemProps {
  contextMenuItems?: DropdownItem[] | (() => DropdownItem[]);
  isActive?: boolean;
  isLoading?: boolean;
  isUpdating?: boolean;
  onClick: () => void;
  onDelete: (e: MouseEvent) => void;
  style?: CSSProperties;
  topic: ImageGenerationTopic;
}

const GridItem = memo<TopicItemProps>(
  ({ isUpdating, topic, style, isLoading, onClick, isActive, contextMenuItems }) => {
    const { namespace } = useGenerationTopicContext();
    const { t } = useTranslation(namespace);
    const activeWorkspaceId = useActiveWorkspaceId();

    const title = topic.title || t('topic.untitled');
    const creator = topic.creator;
    // Sidebar cards stay clean — no avatar overlay. Ownership is surfaced only
    // on hover through the tooltip's second line, and only inside a workspace.
    const showCreatorLine = Boolean(activeWorkspaceId && creator?.id);
    const creatorName = creator?.fullName || creator?.username || '';
    const tooltipTitle = showCreatorLine ? (
      <Flexbox gap={2}>
        <span>{title}</span>
        <span style={{ opacity: 0.66 }}>{t('topic.createdBy', { name: creatorName })}</span>
      </Flexbox>
    ) : (
      title
    );

    return (
      <Tooltip title={tooltipTitle}>
        <ContextMenuTrigger items={contextMenuItems}>
          <Avatar
            alt={title}
            avatar={topic.coverUrl ?? title}
            className={stylex.props(styles.gridItem, isActive && styles.gridItemActive).className}
            classNames={{ img: stylex.props(styles.gridItemImg).className }}
            loading={isLoading || isUpdating}
            style={style}
            onClick={onClick}
          />
        </ContextMenuTrigger>
      </Tooltip>
    );
  },
);

export default GridItem;
