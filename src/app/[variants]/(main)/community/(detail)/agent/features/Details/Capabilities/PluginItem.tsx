import {
  KLAVIS_SERVER_TYPES,
  getLobehubSkillProviderById,
  type KlavisServerType,
  type LobehubSkillProviderType,
} from '@lobechat/const';
import { type DiscoverPluginDetail, type PluginSource } from '@lobechat/types';
import { Avatar, Block, Flexbox, Icon, Image, Skeleton, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import { useDiscoverStore } from '@/store/discover';
import { builtinTools } from '@/tools';

/**
 * Icon component for built-in tools (Klavis & LobehubSkill)
 * For string type icon, use Image component to render
 * For IconType type icon, use Icon component to render with theme fill color
 */
const BuiltinToolIcon = memo<
  Pick<KlavisServerType | LobehubSkillProviderType, 'icon' | 'label'>
>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <Image alt={label} height={40} src={icon} style={{ flex: 'none' }} width={40} />;
  }

  // Use theme color fill, automatically adapts in dark mode
  return <Icon fill={cssVar.colorText} icon={icon} size={40} />;
});

BuiltinToolIcon.displayName = 'BuiltinToolIcon';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    clickable: css`
      cursor: pointer;

      &:hover {
        .plugin-title {
          color: ${cssVar.colorLink};
        }
      }
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      font-size: 14px !important;
      color: ${cssVar.colorTextSecondary};
    `,
    noLink: css`
      cursor: default;
    `,
    tag: css`
      flex-shrink: 0;
    `,
    title: css`
      margin: 0 !important;
      font-size: 14px !important;
      font-weight: 500 !important;
    `,
    titleRow: css`
      display: flex;
      gap: 8px;
      align-items: center;
    `,
  };
});

interface PluginItemProps {
  identifier: string;
}

const PluginItem = memo<PluginItemProps>(({ identifier }) => {
  const { t } = useTranslation('discover');
  const usePluginDetail = useDiscoverStore((s) => s.usePluginDetail);
  const { data: apiData, isLoading } = usePluginDetail({ identifier, withManifest: false });

  // Try to get Klavis tool info if API returns no data
  const klavisTool = useMemo(() => {
    return KLAVIS_SERVER_TYPES.find((tool) => tool.identifier === identifier);
  }, [identifier]);

  // Try to get LobehubSkill info if API returns no data
  const lobehubSkill = useMemo(() => {
    return getLobehubSkillProviderById(identifier);
  }, [identifier]);

  // Try to get builtin tool info if API returns no data
  const builtinTool = useMemo(() => {
    return builtinTools.find((tool) => tool.identifier === identifier);
  }, [identifier]);

  // Convert built-in tools to plugin detail format
  const data: DiscoverPluginDetail | undefined = useMemo(() => {
    if (apiData) return apiData;

    // Check Klavis tools
    if (klavisTool) {
      return {
        author: 'Klavis',
        avatar: '', // Avatar will be rendered by BuiltinToolIcon component
        category: undefined,
        createdAt: '',
        description: `LobeHub Mcp Server: ${klavisTool.label}`,
        homepage: 'https://klavis.ai',
        identifier: klavisTool.identifier,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin' as const,
        tags: ['klavis', 'mcp'],
        title: klavisTool.label,
      };
    }

    // Check LobehubSkill providers
    if (lobehubSkill) {
      return {
        author: lobehubSkill.author,
        avatar: '', // Avatar will be rendered by BuiltinToolIcon component
        category: undefined,
        createdAt: '',
        description: lobehubSkill.description,
        homepage: lobehubSkill.authorUrl || 'https://lobehub.com',
        identifier: lobehubSkill.id,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin' as const,
        tags: ['lobehub-skill'],
        title: lobehubSkill.label,
      };
    }

    // Check builtin tools (like lobe-cloud-sandbox, lobe-memory, etc.)
    if (builtinTool) {
      return {
        author: 'LobeHub',
        avatar: builtinTool.manifest.meta.avatar || '',
        category: undefined,
        createdAt: '',
        description: builtinTool.manifest.meta.description || '',
        homepage: 'https://lobehub.com',
        identifier: builtinTool.identifier,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin' as const,
        tags: builtinTool.manifest.meta.tags || ['builtin-tool'],
        title: builtinTool.manifest.meta.title,
      };
    }

    return undefined;
  }, [apiData, klavisTool, lobehubSkill, builtinTool]);

  const sourceConfig = useMemo(() => {
    const source: PluginSource = data?.source || 'market';

    switch (source) {
      case 'builtin': {
        return {
          clickable: false,
          href: undefined,
          isExternal: false,
          tagColor: 'geekblue' as const,
          tagText: t('plugins.builtinTag'),
        };
      }
      case 'legacy': {
        return {
          clickable: true,
          href: data?.homepage,
          isExternal: true,
          tagColor: 'orange' as const,
          tagText: t('plugins.legacyTag'),
        };
      }
      // eslint-disable-next-line unicorn/no-useless-switch-case
      case 'market':
      default: {
        return {
          clickable: true,
          href: urlJoin('/community/mcp', identifier),
          isExternal: false,
          tagColor: undefined,
          tagText: undefined,
        };
      }
    }
  }, [data?.source, data?.homepage, identifier, t]);

  if (isLoading)
    return (
      <Block gap={12} horizontal key={identifier} padding={12} variant={'outlined'}>
        <Skeleton paragraph={{ rows: 1 }} title={false} />
      </Block>
    );

  // If loading is complete but no data found, don't render anything
  if (!data) return null;

  // Render avatar - use BuiltinToolIcon for built-in tools, Avatar for others
  const renderAvatar = () => {
    if (klavisTool) {
      return <BuiltinToolIcon icon={klavisTool.icon} label={klavisTool.label} />;
    }
    if (lobehubSkill) {
      return <BuiltinToolIcon icon={lobehubSkill.icon} label={lobehubSkill.label} />;
    }
    return <Avatar avatar={data.avatar} shape={'square'} size={40} style={{ flex: 'none' }} />;
  };

  const content = (
    <Block
      className={cx(sourceConfig.clickable ? styles.clickable : styles.noLink)}
      gap={12}
      horizontal
      key={identifier}
      padding={12}
      variant={'outlined'}
    >
      {renderAvatar()}
      <Flexbox
        flex={1}
        gap={6}
        style={{
          overflow: 'hidden',
        }}
      >
        <div className={styles.titleRow}>
          <Text as={'h2'} className={cx(styles.title, 'plugin-title')} ellipsis>
            {data.title}
          </Text>
          {sourceConfig.tagText && (
            <Tag className={styles.tag} color={sourceConfig.tagColor} size={'small'}>
              {sourceConfig.tagText}
            </Tag>
          )}
        </div>
        <Text
          as={'p'}
          className={styles.desc}
          ellipsis={{
            rows: 2,
          }}
        >
          {data.description}
        </Text>
      </Flexbox>
    </Block>
  );

  // For builtin plugins, no link wrapper
  if (!sourceConfig.clickable) {
    return content;
  }

  // For external links (legacy plugins), use <a> tag
  if (sourceConfig.isExternal && sourceConfig.href) {
    return (
      <a href={sourceConfig.href} rel="noopener noreferrer" target="_blank">
        {content}
      </a>
    );
  }

  // For internal links (market plugins), use Link component
  if (sourceConfig.href) {
    return <Link to={sourceConfig.href}>{content}</Link>;
  }

  return content;
});

export default PluginItem;
