'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, useState } from 'react';

import { useDetailContext } from './DetailContext';
import Header from './Header';
import Nav, { type TabKey } from './Nav';
import Overview from './Overview';
import Schema from './Schema';

interface SkillDetailInnerProps {
  type: 'klavis' | 'lobehub';
}

const SkillDetailInner = memo<SkillDetailInnerProps>(({ type }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const { toolsLoading } = useDetailContext();

  if (toolsLoading) {
    return (
      <Flexbox gap={16}>
        <Skeleton active paragraph={{ rows: 3 }} />
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <Header type={type} />
      <Nav activeTab={activeTab} setActiveTab={setActiveTab} />
      {activeTab === 'overview' ? <Overview /> : <Schema />}
    </Flexbox>
  );
});

export default SkillDetailInner;
