'use client';

import { type PropsWithChildren, memo } from 'react';
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
            href: '/community',
            title: t('tab.community'),
          },
        ]}
      />
      <Nav />
    </>
  );
});

export default Header;
