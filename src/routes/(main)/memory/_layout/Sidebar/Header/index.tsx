'use client';

import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Nav from './Nav';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');
  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/memory',
            title: t('tab.memory'),
          },
        ]}
      />
      <Nav />
    </>
  );
});

export default Header;
