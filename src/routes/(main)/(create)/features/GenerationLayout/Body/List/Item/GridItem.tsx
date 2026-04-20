'use client';

import { Avatar, ContextMenuTrigger, type GenericItemType, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { CSSProperties, MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ImageGenerationTopic } from '@/types/generation';

import { useGenerationTopicContext } from '../StoreContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  gridItem: css`
    cursor: pointer;

    position: relative;

    aspect-ratio: 1;
    width: 100% !important;
    height: auto !important;
    border-radius: 4px;

    object-fit: cover;
    background: ${cssVar.colorFillSecondary};

    transition: border 0.15s ${cssVar.motionEaseInOut};

    img {
      aspect-ratio: 1;
      width: 100% !important;
    }
  `,
  gridItemActive: css`
    border: 2px solid ${cssVar.colorBgLayout} !important;
    box-shadow: 0 0 0 2px ${cssVar.colorPrimary};
  `,
}));

interface TopicItemProps {
  contextMenuItems?: GenericItemType[] | (() => GenericItemType[]);
  isActive?: boolean;
  isLoading?: boolean;
  isUpdating?: boolean;
  onClick: () => void;
  onDelete: (e: MouseEvent) => void;
  style?: CSSProperties;
  topic: ImageGenerationTopic;
}

const GridItem = memo<TopicItemProps>(
  ({ isUpdating, topic, style, isLoading, onClick, onDelete, isActive, contextMenuItems }) => {
    const { namespace } = useGenerationTopicContext();
    const { t } = useTranslation(namespace);

    return (
      <Tooltip title={topic.title || t('topic.untitled')}>
        <ContextMenuTrigger items={contextMenuItems}>
          <Avatar
            alt={topic.title || t('topic.untitled')}
            avatar={topic.coverUrl ?? (topic.title || t('topic.untitled'))}
            className={cx(styles.gridItem, isActive && styles.gridItemActive)}
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
