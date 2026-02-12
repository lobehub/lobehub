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
        horizontal
        align="center"
        gap={8}
        justify="space-between"
        width={'100%'}
        style={{
          marginBottom: 12,
        }}
      >
        <div>
          {t('topic.title')} {count ? count : ''}
        </div>
        <ActionIcon
          icon={Plus}
          size={'small'}
          title={t('topic.createNew')}
          tooltipProps={{
            placement: 'left',
          }}
          onClick={onClick}
        />
      </Flexbox>
    );

  return (
    <ActionIcon
      icon={Plus}
      title={t('topic.createNew')}
      variant={'filled'}
      size={{
        blockSize: 48,
        size: 20,
      }}
      tooltipProps={{
        placement: 'left',
      }}
      onClick={onClick}
    />
  );
});

NewTopicButton.displayName = 'NewTopicButton';

export default NewTopicButton;
