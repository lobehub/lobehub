'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Suspense, lazy, memo, useState } from 'react';

import Agents from './Agents';
import Header from './Header';
import Nav, { type TabKey } from './Nav';
import Overview from './Overview';

const Schema = lazy(() => import('./Schema'));

const TabSkeleton = () => (
  <Flexbox gap={16}>
    <Skeleton active paragraph={{ rows: 4 }} />
  </Flexbox>
);

interface SkillDetailInnerProps {
  type: 'klavis' | 'lobehub';
}

const SkillDetailInner = memo<SkillDetailInnerProps>(({ type }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const renderContent = () => {
    switch (activeTab) {
      case 'agents': {
        return <Agents />;
      }
      case 'schema': {
        return (
          <Suspense fallback={<TabSkeleton />}>
            <Schema />
          </Suspense>
        );
      }
      default: {
        return <Overview />;
      }
    }
  };

  return (
    <Flexbox gap={16}>
      <Header type={type} />
      <Nav activeTab={activeTab} setActiveTab={setActiveTab} />
      {renderContent()}
    </Flexbox>
  );
});

export default SkillDetailInner;
