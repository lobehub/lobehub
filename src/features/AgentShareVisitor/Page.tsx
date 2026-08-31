'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { ActionIcon, Avatar, Button, Drawer, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import CircleLoading from '@/components/Loading/CircleLoading';
import { useIsMobile } from '@/hooks/useIsMobile';

import { sharedAgentDisplayName } from './displayName';
import { resolveShareAccessState, SHARE_ACCESS_ERROR_KEYS } from './resolveShareAccessState';
import TopicPanel from './TopicPanel';
import { useSharedAgent } from './useSharedAgent';
import VisitorConversation from './VisitorConversation';

const SIDEBAR_WIDTH = 260;

/**
 * Visitor landing page of an agent share (`/share/agent/:slugOrId`): topic list
 * on the left (a drawer on mobile), the shared agent's conversation on the
 * right. Deliberately a trimmed shell — no agent switcher, task list, working
 * sidebar, terminal, or model picker.
 */
const AgentShareVisitorPage = memo(() => {
  const { t } = useTranslation('agent');
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, error, isLoading, mutate } = useSharedAgent(slugOrId);

  if (isLoading && !data) return <CircleLoading />;

  if (error || !data) {
    const state = resolveShareAccessState(error);

    if (state === 'signIn') {
      const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/share/agent/${slugOrId ?? ''}`)}`;

      return (
        <Center gap={16} height={'100%'} padding={24}>
          <Text fontSize={16} weight={600}>
            {t('share.visitor.access.signInTitle')}
          </Text>
          <Text style={{ maxWidth: 360, textAlign: 'center' }} type={'secondary'}>
            {t('share.visitor.access.signInDesc')}
          </Text>
          <Button href={signInUrl} size={'large'} type={'primary'}>
            {t('share.visitor.access.signInCta')}
          </Button>
        </Center>
      );
    }

    const title =
      state === 'generic'
        ? undefined
        : t(SHARE_ACCESS_ERROR_KEYS[state] as 'share.visitor.access.notFound');

    return (
      <Center height={'100%'} padding={24}>
        <AsyncError
          error={error}
          title={title}
          variant={'page'}
          // A missing / forbidden share never becomes available by retrying.
          onRetry={state === 'generic' ? () => void mutate() : undefined}
        />
      </Center>
    );
  }

  const isOwnerPreview = data.isOwner;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      {!isMobile && (
        <Flexbox
          style={{ borderInlineEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
          width={SIDEBAR_WIDTH}
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
          style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
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
        {/* Always shown, never dismissible: the visitor is chatting inside the
            creator's account, so "the creator may be able to read this" is a
            standing fact about the surface, not a one-time tip. */}
        <Flexbox
          paddingBlock={6}
          paddingInline={12}
          style={{ background: cssVar.colorFillQuaternary }}
        >
          <Text fontSize={12} type={'secondary'}>
            {isOwnerPreview ? t('share.visitor.ownerPreview') : t('share.visitor.privacyNotice')}
          </Text>
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
