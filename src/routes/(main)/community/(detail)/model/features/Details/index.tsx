'use client';

import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import { ModelNavKey } from '@/types/discover';

import Sidebar from '../Sidebar';
import Nav from './Nav';
import Overview from './Overview';
import Parameter from './Parameter';
import Related from './Related';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTab, setActiveTab] = useQueryState('activeTab', {
    clearOnDefault: true,
    defaultValue: ModelNavKey.Overview,
  });

  return (
    <Flexbox gap={24}>
      <Nav activeTab={activeTab as ModelNavKey} mobile={mobile} setActiveTab={setActiveTab} />
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          {activeTab === ModelNavKey.Overview && <Overview />}
          {activeTab === ModelNavKey.Parameter && <Parameter />}
          {activeTab === ModelNavKey.Related && <Related />}
        </Flexbox>
        <Sidebar mobile={mobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
