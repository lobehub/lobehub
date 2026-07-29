'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';

import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';

import {
  DEVTOOLS_AGENT_ID,
  DEVTOOLS_AGENT_META,
  DEVTOOLS_GROUP_DETAIL,
  DEVTOOLS_GROUP_ID,
} from './fixtures';
import Sidebar from './Sidebar';
import ToolPage from './ToolPage';
import { useDevtoolsEntries } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    flex: 1;
    align-items: center;
    justify-content: center;

    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  main: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;
    min-height: 0;

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

const RenderGallery = () => {
  const { defaultToolset, menuItems, toolsetMap } = useDevtoolsEntries();
  const [identifier, setIdentifier] = useState<string | undefined>(defaultToolset?.identifier);
  const toolset = identifier ? toolsetMap.get(identifier) : undefined;

  useEffect(() => {
    const previousGroupState = useAgentGroupStore.getState();

    useAgentGroupStore.setState({
      activeGroupId: DEVTOOLS_GROUP_ID,
      groupMap: {
        ...previousGroupState.groupMap,
        [DEVTOOLS_GROUP_ID]: DEVTOOLS_GROUP_DETAIL as any,
      },
    });

    // Seed the Aggregate-preview agent meta so its turns read as "Lobe AI"
    // (avatar + name) instead of the unresolved-agent fallback.
    const previousAgentMap = useAgentStore.getState().agentMap;
    useAgentStore.setState({
      agentMap: { ...previousAgentMap, [DEVTOOLS_AGENT_ID]: DEVTOOLS_AGENT_META as any },
    });

    return () => {
      useAgentGroupStore.setState({
        activeGroupId: previousGroupState.activeGroupId,
        groupMap: previousGroupState.groupMap,
      });
      useAgentStore.setState({ agentMap: previousAgentMap });
    };
  }, []);

  return (
    <Flexbox horizontal className={styles.page}>
      <Sidebar items={menuItems} selectedKey={identifier} onSelect={setIdentifier} />
      <Flexbox className={styles.main}>
        {toolset ? (
          <ToolPage toolset={toolset} />
        ) : (
          <Flexbox className={styles.empty}>No builtin tool renders registered.</Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default RenderGallery;
