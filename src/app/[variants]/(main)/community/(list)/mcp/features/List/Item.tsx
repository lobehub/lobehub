'use client';

import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Avatar,
  Block,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
  stopPropagation,
} from '@lobehub/ui';
import { Spotlight } from '@lobehub/ui/awesome';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import InstallationIcon from '@/components/MCPDepsIcon';
import OfficialIcon from '@/components/OfficialIcon';
import PublishedTime from '@/components/PublishedTime';
import Scores from '@/features/MCP/Scores';
import { discoverService } from '@/services/discover';
import { type DiscoverMcpItem } from '@/types/discover';

import ConnectionTypeTag from './ConnectionTypeTag';
import MetaInfo from './MetaInfo';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      color: ${cssVar.colorTextDescription};
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${cssVar.colorTextSecondary};
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
  };
});

const McpItem = memo<DiscoverMcpItem>(
  ({
    name,
    icon,
    author,
    description,
    identifier,
    category,
    isValidated,
    isFeatured,
    isClaimed,
    isOfficial,
    toolsCount,
    updatedAt,
    installationMethods,
    promptsCount,
    resourcesCount,
    connectionType,
    installCount,
    github,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const link = urlJoin('/community/mcp', identifier);

    const handleClick = useCallback(() => {
      discoverService
        .reportMcpEvent({
          event: 'click',
          identifier,
          source: location.pathname,
        })
        .catch(() => {});

      navigate(link);
    }, [identifier, link, navigate]);

    return (
      <Block
        clickable
        data-testid="mcp-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        {isFeatured && <Spotlight size={400} />}
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            horizontal
            gap={12}
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <Avatar avatar={icon} shape={'square'} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={8}
                style={{
                  overflow: 'hidden',
                }}
              >
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={styles.title}>
                    {name}
                  </Text>
                </Link>
                {isOfficial && (
                  <Tooltip title={t('isOfficial')}>
                    <OfficialIcon />
                  </Tooltip>
                )}
              </Flexbox>
              {author && <div className={styles.author}>{author}</div>}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            {installationMethods && <InstallationIcon type={installationMethods} />}
            {github && (
              <a
                href={github.url}
                rel="noopener noreferrer"
                target={'_blank'}
                onClick={stopPropagation}
              >
                <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
              </a>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <Scores
            github={github}
            identifier={identifier}
            installationMethods={installationMethods}
            isClaimed={isClaimed}
            isValidated={isValidated}
            overview={{ readme: github?.url }}
            promptsCount={promptsCount}
            resourcesCount={resourcesCount}
            toolsCount={toolsCount}
          />
          <Text
            as={'p'}
            className={styles.desc}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.secondaryDesc}
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={styles.secondaryDesc}
                date={updatedAt}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={8}>
              {t(`mcp.categories.${category}.name` as any)}
              {isFeatured && (
                <Tag
                  size={'small'}
                  variant={'outlined'}
                  style={{
                    color: 'inherit',
                    fontSize: 'inherit',
                  }}
                >
                  {t('isFeatured')}
                </Tag>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <ConnectionTypeTag type={connectionType} />
          <MetaInfo
            className={styles.secondaryDesc}
            installCount={installCount}
            stars={github?.stars}
          />
        </Flexbox>
      </Block>
    );
  },
);

export default McpItem;
