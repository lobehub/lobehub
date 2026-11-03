'use client';

import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Avatar,
  Block,
  Flexbox,
  Icon,
  stopPropagation,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { Spotlight } from '@lobehub/ui/awesome';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClockIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import InstallationIcon from '@/components/MCPDepsIcon';
import OfficialIcon from '@/components/OfficialIcon';
import PublishedTime from '@/components/PublishedTime';
import Scores from '@/features/MCP/Scores';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { discoverService } from '@/services/discover';
import { type DiscoverMcpItem } from '@/types/discover';

import ConnectionTypeTag from './ConnectionTypeTag';
import MetaInfo from './MetaInfo';

const styles = stylex.create({
  author: { color: cssVar.colorTextDescription },
  desc: { flex: '1', margin: '0', color: cssVar.colorTextSecondary },
  footer: {
    marginBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  secondaryDesc: { fontSize: '12px', color: cssVar.colorTextDescription },
  title: {
    margin: '0',
    fontSize: '16px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
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
    const navigate = useWorkspaceAwareNavigate();
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
                <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
                    {name}
                  </Text>
                </WorkspaceLink>
                {isOfficial && (
                  <Tooltip title={t('isOfficial')}>
                    <OfficialIcon />
                  </Tooltip>
                )}
              </Flexbox>
              {author && <div className={stylex.props(styles.author).className}>{author}</div>}
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
            className={stylex.props(styles.desc).className}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.secondaryDesc).className}
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={stylex.props(styles.secondaryDesc).className}
                date={updatedAt}
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
          className={stylex.props(styles.footer).className}
          justify={'space-between'}
          padding={16}
        >
          <ConnectionTypeTag type={connectionType} />
          <MetaInfo
            className={stylex.props(styles.secondaryDesc).className}
            installCount={installCount}
            stars={github?.stars}
          />
        </Flexbox>
      </Block>
    );
  },
);

export default McpItem;
