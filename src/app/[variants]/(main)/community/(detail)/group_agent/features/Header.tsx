'use client';

import {
  ActionIcon,
  Avatar,
  Button,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
  TooltipGroup,
} from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import {
  BookmarkCheckIcon,
  BookmarkIcon,
  DotIcon,
  GitBranchIcon,
  HeartIcon,
  UsersIcon,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { socialService } from '@/services/social';

import { useDetailContext } from './DetailProvider';
import GroupAgentForkTag from './GroupAgentForkTag';

const styles = createStaticStyles(({ css, cssVar }) => ({
  time: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const data = useDetailContext();
  const { mobile = isMobile } = useResponsive();
  const { isAuthenticated, signIn, session } = useMarketAuth();
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  const {
    memberAgents = [],
    author,
    avatar,
    title,
    category,
    identifier,
    createdAt,
    userName,
    forkCount,
  } = data;

  const displayAvatar = avatar || title?.[0] || '👥';
  const memberCount = memberAgents?.length || 0;

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  // TODO: Use 'group_agent' type when social service supports it
  // Fetch favorite status
  const { data: favoriteStatus, mutate: mutateFavorite } = useSWR(
    identifier && isAuthenticated ? ['favorite-status', 'agent', identifier] : null,
    () => socialService.checkFavoriteStatus('agent-group', identifier!),
    { revalidateOnFocus: false },
  );

  const isFavorited = favoriteStatus?.isFavorited ?? false;

  // Fetch like status
  const { data: likeStatus, mutate: mutateLike } = useSWR(
    identifier && isAuthenticated ? ['like-status', 'agent', identifier] : null,
    () => socialService.checkLikeStatus('agent', identifier!),
    { revalidateOnFocus: false },
  );
  const isLiked = likeStatus?.isLiked ?? false;

  const handleFavoriteClick = async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }

    if (!identifier) return;

    setFavoriteLoading(true);
    try {
      if (isFavorited) {
        await socialService.removeFavorite('agent-group', identifier);
        message.success(t('assistant.unfavoriteSuccess'));
      } else {
        await socialService.addFavorite('agent-group', identifier);
        message.success(t('assistant.favoriteSuccess'));
      }
      await mutateFavorite();
    } catch {
      message.error(t('assistant.favoriteFailed'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleLikeClick = async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }

    if (!identifier) return;

    setLikeLoading(true);
    try {
      if (isLiked) {
        await socialService.unlike('agent', identifier);
        message.success(t('assistant.unlikeSuccess'));
      } else {
        await socialService.like('agent', identifier);
        message.success(t('assistant.likeSuccess'));
      }
      await mutateLike();
    } catch {
      message.error(t('assistant.likeFailed'));
    } finally {
      setLikeLoading(false);
    }
  };

  const cateButton = category ? (
    <Link
      to={qs.stringifyUrl({
        query: { category },
        url: '/community/group_agent',
      })}
    >
      <Button size={'middle'} variant={'outlined'}>
        {category}
      </Button>
    </Link>
  ) : null;

  return (
    <Flexbox gap={12}>
      <Flexbox align={'flex-start'} gap={16} horizontal width={'100%'}>
        <Avatar avatar={displayAvatar} shape={'square'} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Flexbox
              align={'center'}
              flex={1}
              gap={12}
              horizontal
              style={{
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Text
                as={'h1'}
                ellipsis
                style={{ fontSize: mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {title}
              </Text>
            </Flexbox>
            <Tooltip title={isLiked ? t('assistant.unlike') : t('assistant.like')}>
              <ActionIcon
                icon={HeartIcon}
                loading={likeLoading}
                onClick={handleLikeClick}
                style={isLiked ? { color: '#ff4d4f' } : undefined}
              />
            </Tooltip>
            <Tooltip title={isFavorited ? t('assistant.unfavorite') : t('assistant.favorite')}>
              <ActionIcon
                icon={isFavorited ? BookmarkCheckIcon : BookmarkIcon}
                loading={favoriteLoading}
                onClick={handleFavoriteClick}
                variant={isFavorited ? 'outlined' : undefined}
              />
            </Tooltip>
          </Flexbox>
          <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
            {(() => {
              // API returns author as object {avatar, name, userName}, but type definition says string
              const authorObj =
                typeof author === 'object' && author !== null ? (author as any) : null;
              const authorName = authorObj ? authorObj.name || authorObj.userName : author;

              return authorName && userName ? (
                <Link style={{ color: 'inherit' }} to={urlJoin('/community/user', userName)}>
                  {authorName}
                </Link>
              ) : (
                authorName
              );
            })()}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={createdAt as string}
              template={'MMM DD, YYYY'}
            />
            <GroupAgentForkTag />
            {!!forkCount && forkCount > 0 && (
              <Tag bordered={false} color="default" icon={<Icon icon={GitBranchIcon} />}>
                {forkCount} {t('fork.forks')}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <TooltipGroup>
        <Flexbox
          align={'center'}
          gap={mobile ? 12 : 24}
          horizontal
          style={{
            color: cssVar.colorTextSecondary,
          }}
        >
          {!mobile && cateButton}
          {Boolean(memberCount) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('groupAgents.memberCount', { defaultValue: 'Members' })}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <Icon icon={UsersIcon} />
                {memberCount}
              </Flexbox>
            </Tooltip>
          )}
        </Flexbox>
      </TooltipGroup>
    </Flexbox>
  );
});

export default Header;
