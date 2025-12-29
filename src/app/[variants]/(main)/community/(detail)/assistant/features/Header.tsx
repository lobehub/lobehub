'use client';

import { MCP } from '@lobehub/icons';
import {
  ActionIcon,
  Avatar,
  Button,
  Flexbox,
  Icon,
  Text,
  Tooltip,
  TooltipGroup,
} from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { BookTextIcon, BookmarkCheckIcon, BookmarkIcon, CoinsIcon, DotIcon } from 'lucide-react';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import urlJoin from 'url-join';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { socialService } from '@/services/social';
import { formatIntergerNumber } from '@/utils/format';

import { useCategory } from '../../../(list)/assistant/features/Category/useCategory';
import PublishedTime from '../../../../../../../components/PublishedTime';
import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  time: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const {
    author,
    identifier,
    createdAt,
    category,
    avatar,
    title,
    tokenUsage,
    pluginCount,
    knowledgeCount,
    userName,
  } = useDetailContext();
  const { mobile = isMobile } = useResponsive();
  const { isAuthenticated, signIn, session } = useMarketAuth();
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  // TODO: enable like feature
  // const [likeLoading, setLikeLoading] = useState(false);

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  // Fetch favorite status
  const { data: favoriteStatus, mutate: mutateFavorite } = useSWR(
    identifier && isAuthenticated ? ['favorite-status', 'agent', identifier] : null,
    () => socialService.checkFavoriteStatus('agent', identifier!),
    { revalidateOnFocus: false },
  );

  const isFavorited = favoriteStatus?.isFavorited ?? false;

  // TODO: enable like feature
  // const { data: likeStatus, mutate: mutateLike } = useSWR(
  //   identifier && isAuthenticated ? ['like-status', 'agent', identifier] : null,
  //   () => socialService.checkLikeStatus('agent', identifier!),
  //   { revalidateOnFocus: false },
  // );
  // const isLiked = likeStatus?.isLiked ?? false;

  const handleFavoriteClick = async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }

    if (!identifier) return;

    setFavoriteLoading(true);
    try {
      if (isFavorited) {
        await socialService.removeFavorite('agent', identifier);
        message.success(t('assistant.unfavoriteSuccess'));
      } else {
        await socialService.addFavorite('agent', identifier);
        message.success(t('assistant.favoriteSuccess'));
      }
      await mutateFavorite();
    } catch (error) {
      console.error('Favorite action failed:', error);
      message.error(t('assistant.favoriteFailed'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  // TODO: enable like feature
  // const handleLikeClick = async () => {
  //   if (!isAuthenticated) {
  //     await signIn();
  //     return;
  //   }
  //   if (!identifier) return;
  //   setLikeLoading(true);
  //   try {
  //     if (isLiked) {
  //       await socialService.unlike('agent', identifier);
  //       message.success(t('assistant.unlikeSuccess'));
  //     } else {
  //       await socialService.like('agent', identifier);
  //       message.success(t('assistant.likeSuccess'));
  //     }
  //     await mutateLike();
  //   } catch (error) {
  //     console.error('Like action failed:', error);
  //     message.error(t('assistant.likeFailed'));
  //   } finally {
  //     setLikeLoading(false);
  //   }
  // };

  const categories = useCategory();
  const cate = categories.find((c) => c.key === category);

  const cateButton = (
    <Link
      to={qs.stringifyUrl({
        query: { category: cate?.key },
        url: '/community/assistant',
      })}
    >
      <Button icon={cate?.icon} size={'middle'} variant={'outlined'}>
        {cate?.label}
      </Button>
    </Link>
  );

  return (
    <Flexbox gap={12}>
      <Flexbox align={'flex-start'} gap={16} horizontal width={'100%'}>
        <Avatar avatar={avatar} shape={'square'} size={mobile ? 48 : 64} />
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
            <Tooltip title={isFavorited ? t('assistant.unfavorite') : t('assistant.favorite')}>
              <ActionIcon
                icon={isFavorited ? BookmarkCheckIcon : BookmarkIcon}
                loading={favoriteLoading}
                onClick={handleFavoriteClick}
                variant={isFavorited ? 'outlined' : undefined}
              />
            </Tooltip>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal>
            {author && userName ? (
              <Link style={{ color: 'inherit' }} to={urlJoin('/community/user', userName)}>
                {author}
              </Link>
            ) : (
              author
            )}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={createdAt as string}
              template={'MMM DD, YYYY'}
            />
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
          {Boolean(tokenUsage) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.tokenUsage')}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <Icon icon={CoinsIcon} />
                {formatIntergerNumber(tokenUsage)}
              </Flexbox>
            </Tooltip>
          )}
          {Boolean(pluginCount) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.withPlugin')}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <Icon fill={cssVar.colorTextSecondary} icon={MCP} />
                {pluginCount}
              </Flexbox>
            </Tooltip>
          )}
          {Boolean(knowledgeCount) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.withKnowledge')}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <Icon icon={BookTextIcon} />
                {knowledgeCount}
              </Flexbox>
            </Tooltip>
          )}
        </Flexbox>
      </TooltipGroup>
    </Flexbox>
  );
});

export default Header;
