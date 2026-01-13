'use client';

import { Avatar, Block, Flexbox, Grid, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { ClockIcon, Heart } from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { type FavoritePluginItem, socialService } from '@/services/social';
import { useDiscoverStore } from '@/store/discover';

import { useUserDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${cssVar.colorTextSecondary};
    `,
    favoriteButton: css`
      cursor: pointer;

      position: absolute;
      inset-block-start: 12px;
      inset-inline-end: 12px;

      color: ${cssVar.colorError};

      opacity: 0;

      transition: opacity 0.2s;
    `,
    footer: css`
      margin-block-start: 16px;
      border-block-start: 1px dashed ${cssVar.colorBorder};
      background: ${cssVar.colorBgContainer};
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${cssVar.colorLink};
      }
    `,
    wrapper: css`
      &:hover .favorite-button {
        opacity: 1;
      }
    `,
  };
});

interface FavoritePluginCardProps extends FavoritePluginItem {
  onUnfavorite: (identifier: string) => void;
  showUnfavorite: boolean;
}

const FavoritePluginCard = memo<FavoritePluginCardProps>(
  ({
    avatar,
    name,
    description,
    createdAt,
    category,
    identifier,
    onUnfavorite,
    showUnfavorite,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();

    const link = qs.stringifyUrl(
      {
        url: urlJoin('/community/plugin', identifier),
      },
      { skipNull: true },
    );

    return (
      <Block
        className={styles.wrapper}
        clickable
        height={'100%'}
        onClick={() => navigate(link)}
        style={{
          cursor: 'pointer',
          overflow: 'hidden',
          position: 'relative',
        }}
        variant={'outlined'}
        width={'100%'}
      >
        {showUnfavorite && (
          <Tooltip title={t('user.unfavorite')}>
            <div
              className={cx('favorite-button', styles.favoriteButton)}
              onClick={(e) => {
                e.stopPropagation();
                onUnfavorite(identifier);
              }}
            >
              <Icon fill="currentColor" icon={Heart} size={16} />
            </div>
          </Tooltip>
        )}
        <Flexbox
          align={'flex-start'}
          gap={16}
          horizontal
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            gap={12}
            horizontal
            style={{
              overflow: 'hidden',
            }}
          >
            <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox align={'center'} gap={8} horizontal>
                <Link
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'inherit', flex: 1, overflow: 'hidden' }}
                  to={link}
                >
                  <Text as={'h3'} className={styles.title} ellipsis style={{ flex: 1 }}>
                    {name}
                  </Text>
                </Link>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <Text
            as={'p'}
            className={styles.desc}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
        </Flexbox>
        <Flexbox
          align={'center'}
          className={styles.footer}
          horizontal
          justify={'space-between'}
          padding={16}
        >
          <Flexbox
            align={'center'}
            className={styles.secondaryDesc}
            horizontal
            justify={'space-between'}
          >
            <Flexbox align={'center'} gap={4} horizontal>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={styles.secondaryDesc}
                date={createdAt}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            {category && t(`category.plugin.${category}` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

interface UserFavoritePluginsProps {
  rows?: number;
}

const UserFavoritePlugins = memo<UserFavoritePluginsProps>(({ rows = 4 }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const { user, isOwner } = useUserDetailContext();
  const { session } = useMarketAuth();

  const useFavoritePlugins = useDiscoverStore((s) => s.useFavoritePlugins);
  const removeFavorite = useDiscoverStore((s) => s.removeFavorite);

  const { data, mutate } = useFavoritePlugins(user.id);

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  const handleUnfavorite = useCallback(
    async (identifier: string) => {
      try {
        const plugin = data?.items.find((p) => p.identifier === identifier);
        if (plugin) {
          await removeFavorite('plugin', (plugin as any).id);
          await mutate();
          message.success(t('user.unfavoriteSuccess'));
        }
      } catch (error) {
        console.error('Unfavorite failed:', error);
        message.error(t('user.unfavoriteFailed'));
      }
    },
    [data, removeFavorite, mutate, message, t],
  );

  // SDK returns { data: [{ plugin: {...}, favoritedAt: string }] } or flat array
  const rawData = data?.items ?? (data as any)?.data ?? [];
  const plugins: FavoritePluginItem[] = rawData.map((item: any) => {
    const plugin = item.plugin || item;
    return {
      avatar: plugin.icon || plugin.avatar || '',
      category: plugin.category || '',
      createdAt: item.favoritedAt || plugin.favoritedAt || plugin.createdAt,
      description: plugin.description || '',
      identifier: plugin.identifier,
      name: plugin.name,
      tags: plugin.tags || [],
    };
  });

  // Don't render if no favorite plugins
  if (plugins.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal>
        <Text fontSize={16} weight={500}>
          {t('user.favoritePlugins')}
        </Text>
        <Tag>{plugins.length}</Tag>
      </Flexbox>
      <Grid rows={rows} width={'100%'}>
        {plugins.map((item) => (
          <FavoritePluginCard
            key={item.identifier}
            {...item}
            onUnfavorite={handleUnfavorite}
            showUnfavorite={isOwner}
          />
        ))}
      </Grid>
    </Flexbox>
  );
});

export default UserFavoritePlugins;
