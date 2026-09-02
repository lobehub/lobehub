'use client';

import { agentDisplayName } from '@lobechat/types';
import { Center, Flexbox } from '@lobehub/ui';
import { ActionIcon, Avatar, Button, Drawer, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import CircleLoading from '@/components/Loading/CircleLoading';
import { useIsMobile } from '@/hooks/useIsMobile';

import { resolveShareAccessState, SHARE_ACCESS_ERROR_KEYS } from './resolveShareAccessState';
import { isShareInteractive } from './shareInteractivity';
import TopicPanel from './TopicPanel';
import { useSharedAgent } from './useSharedAgent';
import VisitorConversation from './VisitorConversation';

const SIDEBAR_WIDTH = 260;

/**
 * Visitor landing page of an agent share (`/agent/:slugOrId`): topic list on
 * the left (a drawer on mobile), the shared agent's conversation on the right.
 * Deliberately a trimmed shell — no agent switcher, task list, working sidebar,
 * terminal, or model picker.
 *
 * The share surface shares its route with the creator's own agent page, so the
 * param is the agent route's `aid`; `AgentRouteSwitch` decides which of the two
 * a given value belongs to.
 */
const AgentShareVisitorPage = memo(() => {
  const { t } = useTranslation('agent');
  const { aid: slugOrId } = useParams<{ aid: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, error, isLoading, mutate } = useSharedAgent(slugOrId);

  if (isLoading && !data) return <CircleLoading />;

  if (error || !data) {
    const state = resolveShareAccessState(error);

    if (state === 'signIn') {
      const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/agent/${slugOrId ?? ''}`)}`;

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
          // A missing / forbidden share never becomes available by retrying,
          // so there is no `onRetry` for those states — the `action` button
          // below is the visitor's only way out of the dead end.
          action={
            state === 'generic' ? undefined : (
              <Button size={'small'} onClick={() => navigate('/')}>
                {t('share.visitor.access.backHome')}
              </Button>
            )
          }
          onRetry={state === 'generic' ? () => void mutate() : undefined}
        />
      </Center>
    );
  }

  const interactive = isShareInteractive(data.visibility);

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      {!isMobile && (
        <Flexbox
          style={{ borderInlineEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
          width={SIDEBAR_WIDTH}
        >
          <TopicPanel enabled={interactive} shareId={data.shareId} />
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
              {agentDisplayName(data.agentMeta)}
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
            {t('share.visitor.privacyNotice')}
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
            enabled={interactive}
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
