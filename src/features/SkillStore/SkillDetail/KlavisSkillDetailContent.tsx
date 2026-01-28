'use client';

import { Flexbox } from '@lobehub/ui';
import type { Klavis } from 'klavis';
import { useState } from 'react';

import Header from './Header';
import { KlavisDetailProvider } from './KlavisDetailProvider';
import Nav, { type TabKey } from './Nav';
import Overview from './Overview';
import Schema from './Schema';

export interface KlavisSkillDetailContentProps {
  identifier: string;
  serverName: Klavis.McpServerName;
}

export const KlavisSkillDetailContent = ({
  identifier,
  serverName,
}: KlavisSkillDetailContentProps) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <KlavisDetailProvider identifier={identifier} serverName={serverName}>
      <Flexbox gap={16}>
        <Header type="klavis" />
        <Nav activeTab={activeTab} setActiveTab={setActiveTab} />
        {activeTab === 'overview' ? <Overview /> : <Schema />}
      </Flexbox>
    </KlavisDetailProvider>
  );
};
