'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import ResourceModeToggle from '@/features/ResourceManager/components/ResourceModeToggle';

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
      <ResourceModeToggle />
      <CategoryMenu />
    </>
  );
});

export default Header;
