'use client';

import { memo } from 'react';

import Menu from '@/components/Menu';
import { type ChatSettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

interface CategoryContentProps {
  setTab: (tab: ChatSettingsTabs) => void;
  tab: string;
}
const AgentCategory = memo<CategoryContentProps>(({ setTab, tab }) => {
  const cateItems = useCategory();
  return (
    <Menu
      compact
      items={cateItems}
      onClick={({ key }) => {
        setTab(key as ChatSettingsTabs);
      }}
      selectable
      selectedKeys={[tab as any]}
    />
  );
});

export default AgentCategory;
