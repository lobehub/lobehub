'use client';

import { Flexbox } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';

import AddButton from './AddButton';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/page',
            title: t('tab.pages'),
          },
        ]}
        right={<AddButton />}
      />
      <Flexbox paddingInline={4}>
        <NavItem
          icon={SearchIcon}
          key={'search'}
          onClick={() => toggleCommandMenu(true)}
          title={t('tab.search')}
        />
      </Flexbox>
    </>
  );
});

export default Header;
