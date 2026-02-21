'use client';

import { Flexbox, Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';

import Header from '../features/Header';
import Ld from './Ld';
import MetaData from './MetaData';
import Og from './Og';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    * {
      font-size: 12px;
    }
    .${prefixCls}-form-item {
      padding-block: 8px;
    }
  `,
}));

enum Tab {
  Ld = 'ld',
  Meta = 'meta',
  Og = 'og',
}

const MetadataViewer = memo(() => {
  const [active, setActive] = useState<Tab>(Tab.Og);
  return (
    <Flexbox
      className={styles.container}
      height={'100%'}
      style={{ overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      <Header
        style={{ paddingInlineStart: 0 }}
        title={
          <Tabs
            compact
            activeKey={active}
            style={{ margin: 16 }}
            items={[
              {
                key: Tab.Og,
                label: 'OG',
              },
              {
                key: Tab.Meta,
                label: 'MetaData',
              },
              {
                key: Tab.Ld,
                label: 'StructuredData',
              },
            ]}
            onChange={(v) => setActive(v as Tab)}
          />
        }
      />
      <Flexbox
        flex={1}
        height={'100%'}
        paddingInline={16}
        style={{ overflow: 'auto', paddingBottom: 16, position: 'relative' }}
        width={'100%'}
      >
        {active === Tab.Og && <Og />}
        {active === Tab.Meta && <MetaData />}
        {active === Tab.Ld && <Ld />}
      </Flexbox>
    </Flexbox>
  );
});

export default MetadataViewer;
