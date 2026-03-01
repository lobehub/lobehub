'use client';

import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: '/image',
          title: t('tab.aiImage'),
        },
      ]}
    />
  );
});

export default Header;
