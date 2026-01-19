'use client';

import { Avatar, Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import NextLink from 'next/link';
import { PropsWithChildren, memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import { DEFAULT_AVATAR } from '@/const/meta';
import GroupAvatar from '@/features/GroupAvatar';
import UserAvatar from '@/features/User/UserAvatar';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import SharePortal from '../features/Portal';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100vw;
    min-height: 100vh;
    background: ${token.colorBgLayout};
  `,
  content: css`
    flex: 1;
    width: 100%;
    padding-block: 24px;
    padding-inline: 24px;
  `,
  footer: css`
    padding-block: 16px;
    padding-inline: 24px;
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
  header: css`
    height: 52px;
    padding: 8px;
  `,
}));

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const { id } = useParams<{ id: string }>();
  const dispatchAgentMap = useAgentStore((s) => s.internal_dispatchAgentMap);
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data } = useSWR(
    id ? ['shared-topic', id] : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  // Set agent meta to agentStore for avatar display
  useEffect(() => {
    if (data?.agentId && data.agentMeta) {
      const meta = {
        avatar: data.agentMeta.avatar ?? undefined,
        backgroundColor: data.agentMeta.backgroundColor ?? undefined,
        title: data.agentMeta.title ?? undefined,
      };
      dispatchAgentMap(data.agentId, meta);
    }
  }, [data?.agentId, data?.agentMeta, dispatchAgentMap]);

  const isGroup = !!data?.groupId;
  const isInboxAgent = !isGroup && data?.agentMeta?.slug === 'inbox';
  const agentOrGroupTitle =
    data?.groupMeta?.title || (isInboxAgent ? 'LobeAI' : data?.agentMeta?.title);
  const agentMarketIdentifier = data?.agentMeta?.marketIdentifier;

  // Build group avatars for GroupAvatar component
  const groupAvatars = useMemo(() => {
    if (!isGroup || !data?.groupMeta?.members) return [];
    return data.groupMeta.members.map((member) => ({
      avatar: member.avatar || DEFAULT_AVATAR,
      backgroundColor: member.backgroundColor || undefined,
    }));
  }, [isGroup, data?.groupMeta?.members]);

  const renderAgentOrGroupAvatar = () => {
    // For group: use GroupAvatar with members
    if (isGroup && groupAvatars.length > 0) {
      return <GroupAvatar avatars={groupAvatars} size={24} />;
    }

    // For inbox agent: skip avatar as it's the same as product icon
    if (isInboxAgent) {
      return null;
    }

    // For agent: use single Avatar
    if (data?.agentMeta?.avatar) {
      return (
        <Avatar
          avatar={data.agentMeta.avatar}
          background={data.agentMeta.backgroundColor || cssVar.colorFillTertiary}
          shape="square"
          size={24}
        />
      );
    }

    return null;
  };

  const renderAgentOrGroupTitle = () => {
    if (!agentOrGroupTitle) return null;

    // If agent has marketIdentifier, render as link to assistant page
    if (agentMarketIdentifier && !data?.groupMeta?.title) {
      return (
        <a href={`/community/agent/${agentMarketIdentifier}`} rel="noreferrer" target="_blank">
          <Typography.Text ellipsis strong>
            {agentOrGroupTitle}
          </Typography.Text>
        </a>
      );
    }

    return (
      <Typography.Text ellipsis strong>
        {agentOrGroupTitle}
      </Typography.Text>
    );
  };

  return (
    <Flexbox className={styles.container}>
      <Flexbox align="center" className={styles.header} gap={12} horizontal justify="space-between">
        <Flexbox align="center" flex={1} gap={12} horizontal>
          {isLogin ? (
            <Link to="/">
              <ProductLogo size={24} />
            </Link>
          ) : (
            <NextLink href="/login">
              <ProductLogo size={24} />
            </NextLink>
          )}
          {renderAgentOrGroupAvatar()}
          {renderAgentOrGroupTitle()}
        </Flexbox>
        {data?.title && (
          <Typography.Text ellipsis strong style={{ textAlign: 'center' }}>
            {data.title}
          </Typography.Text>
        )}
        <Flexbox align="center" flex={1} horizontal justify="flex-end">
          {isLogin && <UserAvatar size={24} />}
        </Flexbox>
      </Flexbox>
      <Flexbox className={styles.content} horizontal style={{ overflow: 'hidden' }}>
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          {children ?? <Outlet />}
        </Flexbox>
        <SharePortal />
      </Flexbox>
      <Typography.Text className={styles.footer}>{t('sharePageDisclaimer')}</Typography.Text>
    </Flexbox>
  );
});

export default ShareTopicLayout;
