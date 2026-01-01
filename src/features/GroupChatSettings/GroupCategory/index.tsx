'use client';

import { memo } from 'react';

import Menu from '@/components/Menu';
import { type GroupSettingsTabs } from '@/store/global/initialState';

import { useChatGroupSettingsCategory } from './useGroupCategory';

interface GroupCategoryProps {
  setTab: (tab: GroupSettingsTabs) => void;
  tab: string;
}

const GroupCategory = memo<GroupCategoryProps>(({ setTab, tab }) => {
  const cateItems = useChatGroupSettingsCategory();
  return (
    <Menu
      compact
      items={cateItems}
      onClick={({ key }) => {
        setTab(key as GroupSettingsTabs);
      }}
      selectable
      selectedKeys={[tab as any]}
    />
  );
});

export default GroupCategory;
