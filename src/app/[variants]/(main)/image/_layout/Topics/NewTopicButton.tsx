'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface NewTopicButtonProps {
  count?: number;
  onClick?: () => void;
  showMoreInfo?: boolean;
}

const NewTopicButton = memo<NewTopicButtonProps>(({ count, onClick, showMoreInfo }) => {
  const { t } = useTranslation('image');

  if (showMoreInfo)
    return (
      <Flexbox
        align="center"
        gap={8}
        horizontal
        justify="space-between"
        style={{
          marginBottom: 12,
        }}
        width={'100%'}
      >
        <div>
          {t('topic.title')} {count ? count : ''}
        </div>
        <ActionIcon
          icon={Plus}
          onClick={onClick}
          size={'small'}
          title={t('topic.createNew')}
          tooltipProps={{
            placement: 'left',
          }}
        />
      </Flexbox>
    );

  return (
    <ActionIcon
      icon={Plus}
      onClick={onClick}
      size={{
        blockSize: 48,
        size: 20,
      }}
      title={t('topic.createNew')}
      tooltipProps={{
        placement: 'left',
      }}
      variant={'filled'}
    />
  );
});

NewTopicButton.displayName = 'NewTopicButton';

export default NewTopicButton;
