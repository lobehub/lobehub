'use client';

import { Flexbox, SearchBar, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CommunityList from './CommunityList';
import LobeHubList from './LobeHubList';

enum SkillStoreTab {
  Community = 'community',
  LobeHub = 'lobehub',
}

export const Content = memo(() => {
  const { t } = useTranslation('setting');
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(SkillStoreTab.LobeHub);
  const [keywords, setKeywords] = useState<string>('');

  const options: SegmentedOptions = [
    { label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub },
    { label: t('skillStore.tabs.community'), value: SkillStoreTab.Community },
  ];

  return (
    <Flexbox gap={16} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={12} paddingBlock={16} paddingInline={16}>
        <Flexbox align={'center'} gap={16} horizontal justify={'space-between'}>
          <Segmented
            onChange={(v) => {
              setActiveTab(v as SkillStoreTab);
              setKeywords('');
            }}
            options={options}
            value={activeTab}
            variant={'filled'}
          />
          <SearchBar
            allowClear
            onSearch={setKeywords}
            placeholder={t('skillStore.search')}
            style={{ width: 240 }}
            value={keywords}
            variant={'borderless'}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ overflow: 'auto' }}>
        {activeTab === SkillStoreTab.LobeHub && <LobeHubList keywords={keywords} />}
        {activeTab === SkillStoreTab.Community && <CommunityList keywords={keywords} />}
      </Flexbox>
    </Flexbox>
  );
});

Content.displayName = 'SkillStoreContent';

export default Content;
