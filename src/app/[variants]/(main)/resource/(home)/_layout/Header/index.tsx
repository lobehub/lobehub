'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import CategoryMenu from './CategoryMenu';

const Header = memo(() => {
  const { t } = useTranslation('common');

  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/resource',
            title: t('tab.resource'),
          },
        ]}
      />
      <CategoryMenu />
    </>
  );
});

export default Header;
