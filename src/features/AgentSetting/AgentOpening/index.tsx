'use client';

import { Form } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OpeningMessage from './OpeningMessage';
import OpeningQuestions from './OpeningQuestions';

const wrapperCol = {
  style: {
    maxWidth: '100%',
    width: '100%',
  },
};

const AgentOpening = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Form
      itemsType={'group'}
      variant={'borderless'}
      items={[
        {
          children: [
            {
              children: <OpeningMessage />,
              desc: t('settingOpening.openingMessage.desc'),
              label: t('settingOpening.openingMessage.title'),
              layout: 'vertical',
              wrapperCol,
            },
            {
              children: <OpeningQuestions />,
              desc: t('settingOpening.openingQuestions.desc'),
              label: t('settingOpening.openingQuestions.title'),
              layout: 'vertical',
              wrapperCol,
            },
          ],
          title: t('settingOpening.title'),
        },
      ]}
    />
  );
});

export default AgentOpening;
