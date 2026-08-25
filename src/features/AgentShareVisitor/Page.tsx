'use client';

import type { SharedAgentData } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { Drawer } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { getServerConfigStoreState, patchServerConfig } from '@/store/serverConfig/store';

import { sharedAgentDisplayName } from './displayName';
import { navigateFromShareToAgent } from './navigation';
import TopicPanel from './TopicPanel';
import VisitorConversation from './VisitorConversation';

/**
 * Visitor landing page of an agent share: topic list on the left (drawer on
 * mobile), the shared agent's conversation on the right.
 */
const AgentShareVisitorPage = memo<{ data: SharedAgentData }>(({ data }) => {
  const { t } = useTranslation('agent');
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (data?.isOwner) navigateFromShareToAgent(data.agentId);
  }, [data?.agentId, data?.isOwner]);

  useEffect(() => {
    // The share micro-app boots ServerConfigStore empty (it never fetches the
    // global server config), but the gateway transport reads
    // `serverConfig.agentGatewayUrl` from that store to build the WebSocket
    // URL. Seed it from the share payload so visitor execution can connect.
    if (!data.agentGatewayUrl) return;
    if (getServerConfigStoreState()?.serverConfig?.agentGatewayUrl) return;
    patchServerConfig({ agentGatewayUrl: data.agentGatewayUrl });
  }, [data.agentGatewayUrl]);

  // Loading and error states render in the route layout's ShareShell.
  // Owners also stay empty while the hard navigation exits the Share router.
  if (data.isOwner) return null;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      {!isMobile && (
        <Flexbox
          style={{ borderInlineEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
          width={260}
        >
          <TopicPanel shareId={data.shareId} />
        </Flexbox>
      )}
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          padding={12}
          style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
        >
          {isMobile && (
            <ActionIcon
              icon={PanelLeftOpen}
              title={t('share.visitor.topics.title')}
              onClick={() => setDrawerOpen(true)}
            />
          )}
          <Avatar
            avatar={data.agentMeta.avatar ?? undefined}
            background={data.agentMeta.backgroundColor ?? undefined}
            size={28}
          />
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <Text ellipsis weight={500}>
              {sharedAgentDisplayName(data.agentMeta)}
            </Text>
            {data.agentMeta.description && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {data.agentMeta.description}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <VisitorConversation data={data} />
      </Flexbox>
      {isMobile && (
        <Drawer
          open={drawerOpen}
          placement={'left'}
          title={t('share.visitor.topics.title')}
          width={280}
          onClose={() => setDrawerOpen(false)}
        >
          {/* The Drawer already renders the title bar — skip the panel's own. */}
          <TopicPanel
            shareId={data.shareId}
            showTitle={false}
            onSelect={() => setDrawerOpen(false)}
          />
        </Drawer>
      )}
    </Flexbox>
  );
});

AgentShareVisitorPage.displayName = 'AgentShareVisitorPage';

export default AgentShareVisitorPage;
