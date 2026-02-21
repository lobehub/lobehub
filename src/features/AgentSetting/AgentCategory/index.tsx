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
      selectable
      items={cateItems}
      selectedKeys={[tab as any]}
      onClick={({ key }) => {
        setTab(key as ChatSettingsTabs);
      }}
    />
  );
});

export default AgentCategory;
