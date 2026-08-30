'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState } from '@/projection';
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

    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    overflow: hidden;
    width: 100%;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

const RenderGallery = () => {
  const { defaultToolset, menuItems, toolsetMap } = useDevtoolsEntries();
  const [identifier, setIdentifier] = useState<string | undefined>(defaultToolset?.identifier);
  const toolset = identifier ? toolsetMap.get(identifier) : undefined;

  useEffect(() => {
    const previousActiveGroupId = useAgentGroupStore.getState().activeGroupId;
    const scope = getCacheScope();

    useAgentGroupStore.setState({ activeGroupId: DEVTOOLS_GROUP_ID });
    getProjectionStoreState().commitChatGroupDetail(
      scope,
      DEVTOOLS_GROUP_DETAIL as any,
      {
        group: 'full',
        members: Object.fromEntries(
          DEVTOOLS_GROUP_DETAIL.agents.map((agent) => [agent.id, 'profile' as const]),
        ),
      },
      'mutation',
    );

    // Seed the Aggregate-preview agent meta so its turns read as "Lobe AI"
    // (avatar + name) instead of the unresolved-agent fallback.
    getProjectionStoreState().commitAgentConfig(
      scope,
      { ...DEVTOOLS_AGENT_META, id: DEVTOOLS_AGENT_ID },
      'full',
      'mutation',
    );

    return () => {
      useAgentGroupStore.setState({ activeGroupId: previousActiveGroupId });
      getProjectionStoreState().deleteChatGroupProjection(scope, DEVTOOLS_GROUP_ID);
      getProjectionStoreState().deleteAgentProjection(scope, DEVTOOLS_AGENT_ID);
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
