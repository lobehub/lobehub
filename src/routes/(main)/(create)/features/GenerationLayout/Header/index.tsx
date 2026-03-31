'use client';

import { Flexbox } from '@lobehub/ui';
import { MessageSquarePlusIcon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useGlobalStore } from '@/store/global';

import type { GenerationLayoutCommonProps } from '../types';

const Header = memo<GenerationLayoutCommonProps>((props) => {
  const { t } = useTranslation('common');
  const { t: tGeneration } = useTranslation(props.namespace);
  const { breadcrumb, useStore } = props;
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const openNewGenerationTopic = useStore((s: any) => s.openNewGenerationTopic);

  return (
    <>
      <SideBarHeaderLayout breadcrumb={breadcrumb} />
      <Flexbox paddingInline={4}>
        <NavItem
          icon={MessageSquarePlusIcon}
          key={'new-topic'}
          title={tGeneration('topic.createNew')}
          onClick={openNewGenerationTopic}
        />
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
