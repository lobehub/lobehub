'use client';

import { Icon } from '@lobehub/ui';
import { type MenuProps } from '@lobehub/ui';
import { App } from 'antd';
import { Trash } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ImageGenerationTopic } from '@/types/generation';

import { useGenerationTopicContext } from '../StoreContext';
import GridItem from './GridItem';
import ListItem from './ListItem';

interface TopicItemProps {
  showMoreInfo?: boolean;
  style?: CSSProperties;
  topic: ImageGenerationTopic;
}

const TopicItem = memo<TopicItemProps>(({ topic, showMoreInfo, style }) => {
  const { useStore, namespace } = useGenerationTopicContext();
  const { t } = useTranslation(namespace);
  const { modal } = App.useApp();
  const [isUpdating, setIsUpdating] = useState(false);
  const isLoading = useStore((s) => s.loadingGenerationTopicIds.includes(topic.id));
  const removeGenerationTopic = useStore((s) => s.removeGenerationTopic);
  const switchGenerationTopic = useStore((s) => s.switchGenerationTopic);
  const activeTopicId = useStore((s) => s.activeGenerationTopicId);

  const isActive = activeTopicId === topic.id;

  const handleClick = () => {
    switchGenerationTopic(topic.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('topic.deleteConfirmDesc'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        setIsUpdating(true);
        try {
          await removeGenerationTopic(topic.id);
        } catch (error) {
          console.error('Delete topic failed:', error);
        }
        setIsUpdating(false);
      },
      title: t('topic.deleteConfirm'),
    });
  };

  const menuItems: MenuProps['items'] = [
    {
      danger: true,
      icon: <Icon icon={Trash} />,
      key: 'delete',
      label: t('delete', { ns: 'common' }),
      onClick: () => {
        modal.confirm({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('topic.deleteConfirmDesc'),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: async () => {
            try {
              await removeGenerationTopic(topic.id);
            } catch (error) {
              console.error('Delete topic failed:', error);
            }
          },
          title: t('topic.deleteConfirm'),
        });
      },
    },
  ];

  const RenderItem = showMoreInfo ? ListItem : GridItem;

  return (
    <RenderItem
      contextMenuItems={menuItems}
      isActive={isActive}
      isLoading={isLoading}
      isUpdating={isUpdating}
      style={style}
      topic={topic}
      onClick={handleClick}
      onDelete={handleDelete}
    />
  );
});

TopicItem.displayName = 'TopicItem';

export default TopicItem;
