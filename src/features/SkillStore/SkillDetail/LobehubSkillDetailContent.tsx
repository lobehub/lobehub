'use client';

import { Flexbox } from '@lobehub/ui';
import { useState } from 'react';

import Header from './Header';
import { LobehubDetailProvider } from './LobehubDetailProvider';
import Nav, { type TabKey } from './Nav';
import Overview from './Overview';
import Schema from './Schema';

export interface LobehubSkillDetailContentProps {
  identifier: string;
}

export const LobehubSkillDetailContent = ({ identifier }: LobehubSkillDetailContentProps) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <LobehubDetailProvider identifier={identifier}>
      <Flexbox gap={16}>
        <Header type="lobehub" />
        <Nav activeTab={activeTab} setActiveTab={setActiveTab} />
        {activeTab === 'overview' ? <Overview /> : <Schema />}
      </Flexbox>
    </LobehubDetailProvider>
  );
};
