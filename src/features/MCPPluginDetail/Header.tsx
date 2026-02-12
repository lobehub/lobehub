'use client';

import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Avatar,
  Button,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
  stopPropagation,
} from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import {
  BookmarkIcon,
  BookmarkMinusIcon,
  CircleIcon,
  DotIcon,
  DownloadIcon,
  ScaleIcon,
  StarIcon,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import OfficialIcon from '@/components/OfficialIcon';
import Scores from '@/features/MCP/Scores';
import { getLanguageColor, getRecommendedDeployment } from '@/features/MCP/utils';
import { useCategory } from '@/hooks/useMCPCategory';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { socialService } from '@/services/social';

import InstallationIcon from '../../components/MCPDepsIcon';
import PublishedTime from '../../components/PublishedTime';
import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css }) => {
  return {
    desc: css`
      color: ${cssVar.colorTextSecondary};
    `,
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    version: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 13px;
    `,
  };
});

const Header = memo<{ inModal?: boolean; mobile?: boolean }>(({ mobile: isMobile, inModal }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const {
    name,
    author,
    version,
    identifier,
    icon,
    updatedAt,
    createdAt,
    github,
    isValidated,
    promptsCount,
    resourcesCount,
    toolsCount,
    deploymentOptions = [],
    category,
    installCount,
    overview,
    isClaimed,
    isOfficial,
  } = useDetailContext();
  const { mobile = isMobile } = useResponsive();
  const { isAuthenticated, signIn, session } = useMarketAuth();
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  // Fetch favorite status
  const { data: favoriteStatus, mutate: mutateFavorite } = useSWR(
    identifier && isAuthenticated ? ['favorite-status', 'plugin', identifier] : null,
    () => socialService.checkFavoriteStatus('plugin', identifier!),
    { revalidateOnFocus: false },
  );

  const isFavorited = favoriteStatus?.isFavorited ?? false;

  const handleFavoriteClick = async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }

    if (!identifier) return;

    setFavoriteLoading(true);
    try {
      if (isFavorited) {
        await socialService.removeFavorite('plugin', identifier);
        message.success(t('assistant.unfavoriteSuccess'));
      } else {
        await socialService.addFavorite('plugin', identifier);
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

  const recommendedDeployment = getRecommendedDeployment(deploymentOptions);
  const categories = useCategory();
  const cate = categories.find((c) => c.key === category);

  const scores = (
    <Scores
      deploymentOptions={deploymentOptions}
      github={github}
      identifier={identifier as string}
      isClaimed={isClaimed}
      isValidated={isValidated}
      overview={overview}
      promptsCount={promptsCount}
      resourcesCount={resourcesCount}
      toolsCount={toolsCount}
    />
  );

  const cateButton = (
    <Link
      to={qs.stringifyUrl({
        query: { category: cate?.key },
        url: '/community/mcp',
      })}
    >
      <Button icon={cate?.icon} size={'middle'} variant={'outlined'}>
        {cate?.label}
      </Button>
    </Link>
  );

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <Avatar avatar={icon} shape={'square'} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={12}
              style={{
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Text
                ellipsis
                as={'h1'}
                style={{ fontSize: inModal ? 20 : mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {name}
              </Text>
              {isOfficial && (
                <Tooltip title={t('isOfficial')}>
                  <OfficialIcon size={24} />
                </Tooltip>
              )}
              {!mobile && scores}
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={6}>
              {recommendedDeployment?.installationMethod && (
                <InstallationIcon type={recommendedDeployment.installationMethod} />
              )}
              {github?.url && (
                <a href={github.url} rel="noreferrer" target={'_blank'} onClick={stopPropagation}>
                  <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
                </a>
              )}
              <Tooltip title={isFavorited ? t('assistant.unfavorite') : t('assistant.favorite')}>
                <ActionIcon
                  icon={isFavorited ? BookmarkMinusIcon : BookmarkIcon}
                  loading={favoriteLoading}
                  variant={isFavorited ? 'outlined' : undefined}
                  onClick={handleFavoriteClick}
                />
              </Tooltip>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <div className={styles.version}>{version}</div>
            <Icon icon={DotIcon} />
            {author?.url ? (
              <a href={author?.url} rel="noreferrer" target={'_blank'}>
                {author?.name}
              </a>
            ) : (
              <span>{author?.name}</span>
            )}
            {isClaimed && <Tag size={'small'}>{t('isClaimed')}</Tag>}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={(updatedAt || createdAt) as string}
              template={'MMM DD, YYYY'}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={mobile ? 12 : 24}
        wrap={'wrap'}
        style={{
          color: cssVar.colorTextSecondary,
        }}
      >
        {mobile && scores}
        {!mobile && cateButton}
        <Flexbox horizontal align={'center'} gap={mobile ? 12 : 24} wrap={'wrap'}>
          {Boolean(github?.language) && (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon
                color={cssVar.colorFillTertiary}
                fill={getLanguageColor(github?.language)}
                icon={CircleIcon}
                size={12}
              />
              {github?.language}
            </Flexbox>
          )}
          {Boolean(github?.license) && (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={ScaleIcon} size={14} />
              {github?.license}
            </Flexbox>
          )}
          {Boolean(installCount) && (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={DownloadIcon} size={14} />
              {installCount}
            </Flexbox>
          )}
          {Boolean(github?.stars) && (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={StarIcon} size={14} />
              {github?.stars}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
