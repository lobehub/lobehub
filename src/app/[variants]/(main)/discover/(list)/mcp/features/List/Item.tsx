'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Block, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { Spotlight } from '@lobehub/ui/awesome';
import { createStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import InstallationIcon from '@/components/MCPDepsIcon';
import OfficialIcon from '@/components/OfficialIcon';
import PublishedTime from '@/components/PublishedTime';
import Scores from '@/features/MCP/Scores';
import { DiscoverMcpItem } from '@/types/discover';

import ConnectionTypeTag from './ConnectionTypeTag';
import MetaInfo from './MetaInfo';

const useStyles = createStyles(({ css, token }) => {
  return {
    author: css`
      color: ${token.colorTextDescription};
    `,
    code: css`
      font-family: ${token.fontFamilyCode};
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${token.colorTextSecondary};
    `,
    footer: css`
      margin-block-start: 16px;
      border-block-start: 1px dashed ${token.colorBorder};
      background: ${token.colorBgContainerSecondary};
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${token.colorTextDescription};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${token.colorLink};
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
    const { styles, theme } = useStyles();
    const navigate = useNavigate();
    const link = urlJoin('/mcp', identifier);
    return (
      <Block
        clickable
        height={'100%'}
        onClick={() => {
          navigate(link);
        }}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        variant={'outlined'}
        width={'100%'}
      >
        {isFeatured && <Spotlight size={400} />}
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
            title={identifier}
          >
            <Avatar avatar={icon} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                align={'center'}
                flex={1}
                gap={8}
                horizontal
                style={{
                  overflow: 'hidden',
                }}
              >
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text as={'h2'} className={styles.title} ellipsis>
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
          <Flexbox align={'center'} gap={4} horizontal>
            {installationMethods && <InstallationIcon type={installationMethods} />}
            {github && (
              <a
                href={github.url}
                onClick={(e) => e.stopPropagation()}
                rel="noopener noreferrer"
                target={'_blank'}
              >
                <ActionIcon fill={theme.colorTextDescription} icon={Github} />
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
            align={'center'}
            className={styles.secondaryDesc}
            horizontal
            justify={'space-between'}
          >
            <Flexbox align={'center'} gap={4} horizontal>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={styles.secondaryDesc}
                date={updatedAt}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            <Flexbox align={'center'} gap={8} horizontal>
              {t(`mcp.categories.${category}.name` as any)}
              {isFeatured && (
                <Tag
                  size={'small'}
                  style={{
                    color: 'inherit',
                    fontSize: 'inherit',
                  }}
                  variant={'outlined'}
                >
                  {t('isFeatured')}
                </Tag>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox
          align={'center'}
          className={styles.footer}
          horizontal
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
