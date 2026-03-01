'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import LibraryHead from './LibraryHead';

const Header = memo(() => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      backTo="/resource"
      left={<LibraryHead id={id || ''} />}
      breadcrumb={[
        {
          href: `/resource/library/${id}`,
          title: t('tab.resource'),
        },
      ]}
    />
  );
});

export default Header;
