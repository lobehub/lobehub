'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openFeedbackModal } from '@/components/FeedbackModal';

const WantMoreSkills = memo(() => {
  const { t } = useTranslation('setting');

  const handleClick = () => {
    openFeedbackModal({
      initialValues: {
        message: t('skillStore.wantMore.feedback.message'),
        title: t('skillStore.wantMore.feedback.title'),
      },
    });
  };

  return (
    <Flexbox align="center" justify="center" paddingBlock={24}>
      <Text type={'secondary'}>
        {t('skillStore.wantMore.reachedEnd')}{' '}
        <a
          href={'#'}
          style={{ color: cssVar.colorLink }}
          onClick={(e) => {
            e.preventDefault();
            handleClick();
          }}
        >
          {t('skillStore.wantMore.action')}
        </a>
      </Text>
    </Flexbox>
  );
});

WantMoreSkills.displayName = 'WantMoreSkills';

export default WantMoreSkills;
