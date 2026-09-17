'use client';

import { Form } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import SandboxEnvironmentManager from '@/features/SandboxEnvironmentManager';

const Page = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Form
      collapsible={false}
      itemsType={'group'}
      variant={'filled'}
      items={[
        {
          children: <SandboxEnvironmentManager />,
          extra: null,
          title: t('sandboxEnvironments.title'),
        },
      ]}
      {...FORM_STYLE}
    />
  );
});

Page.displayName = 'SandboxEnvironmentsSetting';

export default Page;
