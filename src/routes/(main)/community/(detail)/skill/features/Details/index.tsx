'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useDetailContext } from '../DetailProvider';
import Sidebar from '../Sidebar';
import { SkillNavKey } from '../types';
import Installation from './Installation';
import Nav from './Nav';
import Overview from './Overview';
import Related from './Related';
import Resources from './Resources';
import Versions from './Versions';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('activeTab');
  const urlActiveTab = Object.values(SkillNavKey).includes(activeTabParam as SkillNavKey)
    ? (activeTabParam as SkillNavKey)
    : SkillNavKey.Overview;
  const [activeTab, setActiveTab] = useState<SkillNavKey>(urlActiveTab);
  const { content } = useDetailContext();

  useEffect(() => {
    setActiveTab(urlActiveTab);
  }, [urlActiveTab]);

  const handleSetActiveTab = (tab: SkillNavKey) => {
    setActiveTab(tab);
    const nextSearchParams = new URLSearchParams(searchParams);

    if (tab === SkillNavKey.Overview) {
      nextSearchParams.delete('activeTab');
    } else {
      nextSearchParams.set('activeTab', tab);
    }

    setSearchParams(nextSearchParams, { replace: true });
  };

  const skillContent = <Markdown variant={'chat'}>{content ?? ''}</Markdown>;

  return (
    <Flexbox gap={24}>
      <Nav activeTab={activeTab} mobile={isMobile} setActiveTab={handleSetActiveTab} />
      <Flexbox
        gap={48}
        horizontal={!isMobile}
        style={isMobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox flex={1} style={{ minWidth: 0 }} width={'100%'}>
          {activeTab === SkillNavKey.Overview && <Overview>{skillContent}</Overview>}
          {activeTab === SkillNavKey.Installation && <Installation mobile={isMobile} />}
          {activeTab === SkillNavKey.Skill && skillContent}
          {activeTab === SkillNavKey.Resources && <Resources />}
          {activeTab === SkillNavKey.Related && <Related />}
          {activeTab === SkillNavKey.Version && <Versions />}
        </Flexbox>
        <Sidebar activeTab={activeTab} mobile={isMobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
