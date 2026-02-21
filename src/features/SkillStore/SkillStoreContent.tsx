'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import CommunityList from './SkillList/Community';
import CustomList from './SkillList/Custom';
import LobeHubList from './SkillList/LobeHub';

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
        <Flexbox horizontal align={'center'} gap={8}>
          <Segmented
            block
            options={options}
            style={{ flex: 1 }}
            value={activeTab}
            variant={'filled'}
            onChange={(v) => setActiveTab(v as SkillStoreTab)}
          />
          <AddSkillButton />
        </Flexbox>
        <Search activeTab={activeTab} onLobeHubSearch={setLobehubKeywords} />
      </Flexbox>
      <Flexbox height={496}>
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
    </Flexbox>
  );
};
