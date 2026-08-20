'use client';

import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { Drawer } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { useIsMobile } from '@/hooks/useIsMobile';

import TopicPanel from './TopicPanel';
import { useSharedAgent } from './useSharedAgent';
import VisitorConversation from './VisitorConversation';

/**
 * Visitor landing page of an agent share: topic list on the left (drawer on
 * mobile), the shared agent's conversation on the right.
 */
const AgentShareVisitorPage = memo(() => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('agent');
  const { data } = useSharedAgent(id);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Loading and error states render in the route layout's ShareShell.
  if (!data) return null;

  // Creators land back in their own workspace instead of the visitor view.
  if (data.isOwner) return <Navigate replace to={`/agent/${data.agentId}`} />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      {!isMobile && (
        <Flexbox
          style={{ borderInlineEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
          width={260}
        >
          <TopicPanel />
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
              {data.agentMeta.title}
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
          <TopicPanel showTitle={false} />
        </Drawer>
      )}
    </Flexbox>
  );
});

AgentShareVisitorPage.displayName = 'AgentShareVisitorPage';

export default AgentShareVisitorPage;
