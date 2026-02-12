'use client';

import { ActionIcon, Avatar, Flexbox, Popover, Text } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { Trash } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';
import { type ImageGenerationTopic } from '@/types/generation';

const formatTime = (date: Date, locale: string) => {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
  }).format(new Date(date));
};

interface TopicItemProps {
  showMoreInfo?: boolean;
  style?: React.CSSProperties;
  topic: ImageGenerationTopic;
}

const TopicItem = memo<TopicItemProps>(({ topic, showMoreInfo, style }) => {
  const { t } = useTranslation('image');
  const { modal } = App.useApp();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // 检查当前 topic 是否在加载中
  const isLoading = useImageStore(generationTopicSelectors.isLoadingGenerationTopic(topic.id));
  const removeGenerationTopic = useImageStore((s) => s.removeGenerationTopic);
  const switchGenerationTopic = useImageStore((s) => s.switchGenerationTopic);
  const activeTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);

  const isActive = activeTopicId === topic.id;

  const handleClick = () => {
    switchGenerationTopic(topic.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();

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
  };

  const tooltipContent = (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={16}
      justify={'space-between'}
      style={{
        overflow: 'hidden',
      }}
    >
      <Flexbox
        flex={1}
        style={{
          overflow: 'hidden',
        }}
      >
        <Text ellipsis fontSize={14} weight={500}>
          {topic.title || t('topic.untitled')}
        </Text>
        <Text ellipsis fontSize={12} type={'secondary'}>
          {formatTime(topic.updatedAt, locale)}
        </Text>
      </Flexbox>
      <ActionIcon danger icon={Trash} size="small" onClick={handleDelete} />
    </Flexbox>
  );

  return (
    <Popover
      content={tooltipContent}
      placement={'left'}
      trigger={showMoreInfo ? [] : ['hover']}
      styles={{
        content: {
          width: 200,
        },
      }}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        justify={'center'}
        width={'100%'}
        style={{
          cursor: 'pointer',
          ...style,
        }}
        onClick={handleClick}
      >
        <Avatar
          avatar={topic.coverUrl ?? ''}
          background={cssVar.colorFillSecondary}
          bordered={isActive}
          loading={isLoading}
          shape="square"
          size={48}
          style={{
            flex: 'none',
          }}
        />
        {showMoreInfo && tooltipContent}
      </Flexbox>
    </Popover>
  );
});

TopicItem.displayName = 'TopicItem';

export default TopicItem;
