'use client';

import { Form, useForm } from '@lobehub/ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OpeningMessage from './OpeningMessage';
import OpeningQuestions from './OpeningQuestions';

const AgentOpening = memo(() => {
  const { t } = useTranslation('setting');
  const form = useForm();

  return (
    <Form
      form={form}
      itemsType={'flat'}
      variant={'borderless'}
      items={[
        {
          children: <OpeningMessage />,
          desc: t('settingOpening.openingMessage.desc'),
          label: t('settingOpening.openingMessage.title'),
          layout: 'vertical',
        },
        {
          children: <OpeningQuestions />,
          desc: t('settingOpening.openingQuestions.desc'),
          label: t('settingOpening.openingQuestions.title'),
          layout: 'vertical',
        },
      ]}
    />
  );
});

export default AgentOpening;
