'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Center, Flexbox } from '@lobehub/ui';
import { ActionIcon, Avatar, Button, Drawer, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo, type PropsWithChildren, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteMetaBridge } from '@/features/RouteMeta';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useRouteSkeleton } from '@/spa/router/useRouteSkeleton';

import { resolveShareAccessState, SHARE_ACCESS_ERROR_KEYS } from './resolveShareAccessState';
import { isShareInteractive } from './shareInteractivity';
import TopicPanel from './TopicPanel';
import { useSharedAgent } from './useSharedAgent';
import VisitorConversation from './VisitorConversation';
import { buildAgentShareOwnerPath, buildAgentShareSignInUrl } from './visitorPath';
import VisitorTopBar from './VisitorTopBar';

const SIDEBAR_WIDTH = 260;

/**
 * Product bar plus the page body below it. Every state of the page — the
 * conversation, the sign-in prompt, the dead-link card — sits inside the same
 * frame, so the bar never appears or disappears as the share resolves.
 */
const VisitorShell = ({
  children,
  horizontal,
  slugOrId,
}: PropsWithChildren<{ horizontal?: boolean; slugOrId?: string }>) => (
  <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
    <RouteMetaBridge />
    <VisitorTopBar slugOrId={slugOrId} />
    <Flexbox
      flex={1}
      horizontal={horizontal}
      style={{ minHeight: 0, overflow: 'hidden' }}
      width={'100%'}
    >
      {children}
    </Flexbox>
  </Flexbox>
);

/**
 * Visitor landing page of an agent share (`/a/:slugOrId`): the product bar on
 * top, topic list on the left (a drawer on mobile), the shared agent's
 * conversation on the right. Deliberately a trimmed shell — no agent switcher,
 * task list, working sidebar, terminal, or model picker.
 *
 * Registered as a sibling of the main layout, so nothing of the creator-side
 * chrome (nav rail, workspace scope, command palette) is mounted around it;
 * the route-meta bridge that layout would normally provide is mounted here.
 */
const AgentShareVisitorPage = memo(() => {
  const { t } = useTranslation('agent');
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const RouteSkeleton = useRouteSkeleton();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, error, isLoading, mutate } = useSharedAgent(slugOrId);

  /**
   * Reuse the route-owned fallback while data loads. Importing that skeleton
   * back into this lazy page changes the initial shell's shared chunk graph.
   */
  if (isLoading && !data) return RouteSkeleton ? <RouteSkeleton /> : null;

  if (error || !data) {
    const state = resolveShareAccessState(error);

    if (state === 'signIn') {
      const signInUrl = buildAgentShareSignInUrl(slugOrId ?? '');

      return (
        <VisitorShell slugOrId={slugOrId}>
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
        </VisitorShell>
      );
    }

    const title =
      state === 'generic'
        ? undefined
        : t(SHARE_ACCESS_ERROR_KEYS[state] as 'share.visitor.access.notFound');

    return (
      <VisitorShell slugOrId={slugOrId}>
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
      </VisitorShell>
    );
  }

  // The creator is never a visitor of their own share: the visitor chrome
  // (empty topic list, "runs on the creator's account" notice) is meaningless
  // to them, so send them to the share settings instead.
  if (data.isOwner)
    return <Navigate replace to={buildAgentShareOwnerPath(data.agentId, { mobile: isMobile })} />;

  const interactive = isShareInteractive(data.visibility);

  return (
    <VisitorShell horizontal slugOrId={slugOrId}>
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
            // Same fallback the conversation's welcome block uses, so an agent
            // without a custom avatar does not degrade to "UN" initials here.
            avatar={data.agentMeta.avatar ?? DEFAULT_AVATAR}
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
    </VisitorShell>
  );
});

AgentShareVisitorPage.displayName = 'AgentShareVisitorPage';

export default AgentShareVisitorPage;
