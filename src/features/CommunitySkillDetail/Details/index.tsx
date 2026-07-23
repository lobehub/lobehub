'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';

import { SkillNavKey } from '../types';
import Info from './Info';
import Install from './Install';
import Nav from './Nav';
import Overview from './Overview';
import Reviews from './Reviews';

interface DetailsProps {
  /** Controlled active tab; leave undefined for internal state (modal usage) */
  activeTab?: SkillNavKey;
  mobile?: boolean;
  onTabChange?: (tab: SkillNavKey) => void;
}

const Details = memo<DetailsProps>(({ activeTab: controlledTab, mobile, onTabChange }) => {
  const [internalTab, setInternalTab] = useState<SkillNavKey>(SkillNavKey.Overview);
  const activeTab = controlledTab ?? internalTab;

  const handleTabChange = (tab: SkillNavKey) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  return (
    <Flexbox align={'stretch'} gap={24} width={'100%'}>
      <Nav activeTab={activeTab} setActiveTab={handleTabChange} />
      <Flexbox flex={1} style={{ overflow: 'hidden' }} width={'100%'}>
        {activeTab === SkillNavKey.Overview && <Overview />}
        {activeTab === SkillNavKey.Install && <Install mobile={mobile} />}
        {activeTab === SkillNavKey.Reviews && <Reviews />}
        {activeTab === SkillNavKey.Info && <Info />}
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
