'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddSkillButton from './AddSkillButton';
import CommunityList from './CommunityList';
import CustomList from './CustomList';
import LobeHubList from './LobeHubList';
import Search from './Search';

export enum SkillStoreTab {
  Community = 'community',
  Custom = 'custom',
  LobeHub = 'lobehub',
}

export const SkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(SkillStoreTab.LobeHub);
  const [lobehubKeywords, setLobehubKeywords] = useState('');

  const options: SegmentedOptions = [
    { label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub },
    { label: t('skillStore.tabs.community'), value: SkillStoreTab.Community },
    { label: t('skillStore.tabs.custom'), value: SkillStoreTab.Custom },
  ];

  const isLobeHub = activeTab === SkillStoreTab.LobeHub;
  const isCommunity = activeTab === SkillStoreTab.Community;
  const isCustom = activeTab === SkillStoreTab.Custom;

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={8} paddingInline={16}>
        <Flexbox align={'center'} gap={8} horizontal>
          <Segmented
            block
            onChange={(v) => setActiveTab(v as SkillStoreTab)}
            options={options}
            style={{ flex: 1 }}
            value={activeTab}
            variant={'filled'}
          />
          <AddSkillButton />
        </Flexbox>
        <Search activeTab={activeTab} onLobeHubSearch={setLobehubKeywords} />
      </Flexbox>
      <Flexbox flex={1} style={{ display: isLobeHub ? 'flex' : 'none', overflow: 'auto' }}>
        <LobeHubList keywords={lobehubKeywords} />
      </Flexbox>
      <Flexbox flex={1} style={{ display: isCommunity ? 'flex' : 'none', overflow: 'auto' }}>
        <CommunityList />
      </Flexbox>
      <Flexbox flex={1} style={{ display: isCustom ? 'flex' : 'none', overflow: 'auto' }}>
        <CustomList />
      </Flexbox>
    </Flexbox>
  );
};
