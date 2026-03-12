'use client';

import { Flexbox } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useGlobalStore } from '@/store/global';

import type { GenerationLayoutCommonProps } from '../types';
import AddButton from './AddButton';

const Header = memo<GenerationLayoutCommonProps>((props) => {
  const { t } = useTranslation(['common']);
  const { breadcrumb } = props;
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  return (
    <>
      <SideBarHeaderLayout breadcrumb={breadcrumb} right={<AddButton {...props} />} />
      <Flexbox paddingInline={4}>
        <NavItem
          icon={SearchIcon}
          key={'search'}
          title={t('tab.search')}
          onClick={() => toggleCommandMenu(true)}
        />
      </Flexbox>
    </>
  );
});

Header.displayName = 'GenerationLayoutHeader';

export default Header;
