'use client';

import { Form } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';

const Page = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Form
      collapsible={false}
      itemsType={'group'}
      variant={'filled'}
      items={[
        {
          children: <EnvironmentManager />,
          extra: null,
          title: t('environments.title'),
        },
      ]}
      {...FORM_STYLE}
    />
  );
});

Page.displayName = 'EnvironmentsSetting';

export default Page;
