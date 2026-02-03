'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
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
    <Flexbox align="center" justify="center" paddingBlock={24}>
      <Typography.Text type="secondary">
        {t('skillStore.wantMore.reachedEnd')}{' '}
        <Typography.Link onClick={handleClick}>{t('skillStore.wantMore.action')}</Typography.Link>
      </Typography.Text>
    </Flexbox>
  );
});

WantMoreSkills.displayName = 'WantMoreSkills';

export default WantMoreSkills;
