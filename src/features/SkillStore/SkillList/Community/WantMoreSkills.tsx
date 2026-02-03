'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFeedbackModal } from '@/hooks/useFeedbackModal';

const WantMoreSkills = memo(() => {
  const { t } = useTranslation('setting');
  const { open: openFeedbackModal } = useFeedbackModal();

  const handleClick = () => {
    openFeedbackModal({
      message: t('skillStore.wantMore.feedback.message'),
      title: t('skillStore.wantMore.feedback.title'),
    });
  };

  return (
    <Flexbox
      align="center"
      gap={8}
      horizontal
      justify="center"
      paddingBlock={16}
      style={{ borderTop: '1px solid var(--colorBorderSecondary)' }}
    >
      <Text type="secondary">{t('skillStore.wantMore.title')}</Text>
      <Button onClick={handleClick} size="small" type="primary">
        {t('skillStore.wantMore.action')}
      </Button>
    </Flexbox>
  );
});

WantMoreSkills.displayName = 'WantMoreSkills';

export default WantMoreSkills;
