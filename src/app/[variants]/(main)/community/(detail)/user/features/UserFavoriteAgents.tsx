'use client';

import { Avatar, Block, Flexbox, Grid, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { ClockIcon, DownloadIcon, Heart } from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { type FavoriteAgentItem, socialService } from '@/services/social';
import { useDiscoverStore } from '@/store/discover';
import { formatIntergerNumber } from '@/utils/format';

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
    statTag: css`
      border-radius: 4px;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
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

interface FavoriteAgentCardProps extends FavoriteAgentItem {
  onUnfavorite: (identifier: string) => void;
  showUnfavorite: boolean;
}

const FavoriteAgentCard = memo<FavoriteAgentCardProps>(
  ({
    avatar,
    name,
    description,
    createdAt,
    category,
    identifier,
    installCount,
    onUnfavorite,
    showUnfavorite,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();

    const link = qs.stringifyUrl(
      {
        query: { source: 'new' },
        url: urlJoin('/community/agent', identifier),
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
          <Flexbox align={'center'} gap={4} horizontal>
            {installCount !== undefined && (
              <Tooltip
                placement={'top'}
                styles={{ root: { pointerEvents: 'none' } }}
                title={t('assistants.downloads')}
              >
                <Tag className={styles.statTag} icon={<Icon icon={DownloadIcon} />}>
                  {formatIntergerNumber(installCount)}
                </Tag>
              </Tooltip>
            )}
          </Flexbox>
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
            {category && t(`category.assistant.${category}` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

interface UserFavoriteAgentsProps {
  rows?: number;
}

const UserFavoriteAgents = memo<UserFavoriteAgentsProps>(({ rows = 4 }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const { user, isOwner } = useUserDetailContext();
  const { session } = useMarketAuth();

  const useFavoriteAgents = useDiscoverStore((s) => s.useFavoriteAgents);
  const removeFavorite = useDiscoverStore((s) => s.removeFavorite);

  const { data, mutate } = useFavoriteAgents(user.id);

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  const handleUnfavorite = useCallback(
    async (identifier: string) => {
      try {
        const agent = data?.items.find((a) => a.identifier === identifier);
        if (agent) {
          await removeFavorite('agent', (agent as any).id);
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

  // SDK returns { data: [{ agent: {...}, favoritedAt: string }] } or flat array
  const rawData = data?.items ?? (data as any)?.data ?? [];
  const agents: FavoriteAgentItem[] = rawData.map((item: any) => {
    const agent = item.agent || item;
    return {
      avatar: agent.icon || agent.avatar || '',
      category: agent.category || '',
      createdAt: item.favoritedAt || agent.favoritedAt || agent.createdAt,
      description: agent.description || '',
      identifier: agent.identifier,
      installCount: agent.installCount,
      name: agent.name,
      tags: agent.tags || [],
    };
  });

  // Don't render if no favorite agents
  if (agents.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal>
        <Text fontSize={16} weight={500}>
          {t('user.favoriteAgents')}
        </Text>
        <Tag>{agents.length}</Tag>
      </Flexbox>
      <Grid rows={rows} width={'100%'}>
        {agents.map((item) => (
          <FavoriteAgentCard
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

export default UserFavoriteAgents;
