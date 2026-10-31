'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  empty: {
    flex: '1',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    color: cssVar.colorTextTertiary,
  },
  main: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    minHeight: '0',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  page: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

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
    <Flexbox horizontal className={stylex.props(styles.page).className}>
      <Sidebar items={menuItems} selectedKey={identifier} onSelect={setIdentifier} />
      <Flexbox className={stylex.props(styles.main).className}>
        {toolset ? (
          <ToolPage toolset={toolset} />
        ) : (
          <Flexbox className={stylex.props(styles.empty).className}>
            No builtin tool renders registered.
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default RenderGallery;
