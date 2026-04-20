'use client';

import { ActionIcon, Avatar, type GenericItemType } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Trash } from 'lucide-react';
import type { CSSProperties, MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { type ImageGenerationTopic } from '@/types/generation';

import { useGenerationTopicContext } from '../StoreContext';

interface TopicItemProps {
  contextMenuItems?: GenericItemType[] | (() => GenericItemType[]);
  isActive?: boolean;
  isLoading?: boolean;
  isUpdating?: boolean;
  onClick?: () => void;
  onDelete?: (e: MouseEvent) => void;
  style?: CSSProperties;
  topic: ImageGenerationTopic;
}

const ListItem = memo<TopicItemProps>(
  ({ topic, style, isLoading, onClick, onDelete, isActive, isUpdating, contextMenuItems }) => {
    const { namespace } = useGenerationTopicContext();
    const { t } = useTranslation(namespace);

    return (
      <NavItem
        actions={<ActionIcon icon={Trash} size="small" onClick={onDelete} />}
        active={isActive}
        contextMenuItems={contextMenuItems}
        disabled={isUpdating}
        key={topic.id}
        loading={isLoading || isUpdating}
        style={style}
        title={topic.title || t('topic.untitled')}
        icon={
          <Avatar
            avatar={topic.coverUrl ?? ''}
            background={cssVar.colorFillSecondary}
            loading={isLoading}
            shape="square"
            size={32}
            style={{
              flex: 'none',
            }}
          />
        }
        onClick={onClick}
      />
    );
  },
);

export default ListItem;
