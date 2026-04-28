'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useEffect } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';

import { useAgentGroupStore } from '@/store/agentGroup';

import Sidebar from './Sidebar';
import { DEVTOOLS_GROUP_DETAIL, DEVTOOLS_GROUP_ID } from './toolRenderFixtures';
import { toToolsetPath, useDevtoolsEntries } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  main: css`
    overflow: auto;
    flex: 1;
    background:
      radial-gradient(circle at top, ${cssVar.colorFillTertiary} 0%, transparent 35%),
      ${cssVar.colorBgLayout};
  `,
  page: css`
    overflow: hidden;
    width: 100%;
    height: 100%;
  `,
}));

const DevtoolsLayout = () => {
  const { menuItems } = useDevtoolsEntries();
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const previousGroupState = useAgentGroupStore.getState();

    useAgentGroupStore.setState({
      activeGroupId: DEVTOOLS_GROUP_ID,
      groupMap: {
        ...previousGroupState.groupMap,
        [DEVTOOLS_GROUP_ID]: DEVTOOLS_GROUP_DETAIL as any,
      },
    });

    return () => {
      useAgentGroupStore.setState({
        activeGroupId: previousGroupState.activeGroupId,
        groupMap: previousGroupState.groupMap,
      });
    };
  }, []);

  return (
    <Flexbox horizontal className={styles.page}>
      <Sidebar
        items={menuItems}
        selectedKey={identifier}
        onSelect={(key) => navigate(toToolsetPath(key))}
      />
      <Flexbox className={styles.main}>
        <Outlet />
      </Flexbox>
    </Flexbox>
  );
};

export default DevtoolsLayout;
