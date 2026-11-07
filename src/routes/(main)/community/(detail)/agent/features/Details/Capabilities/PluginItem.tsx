import { builtinTools } from '@lobechat/builtin-tools';
import {
  COMPOSIO_APP_TYPES,
  type ComposioAppType,
  getLobehubSkillProviderById,
  type LobehubSkillProviderType,
  OFFICIAL_SITE,
} from '@lobechat/const';
import { type DiscoverPluginDetail, type PluginSource } from '@lobechat/types';
import { Avatar, Block, Flexbox, Icon, Image, Skeleton, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useDiscoverStore } from '@/store/discover';
import { pluginSelectors } from '@/store/discover/selectors';

/**
 * Icon component for built-in tools (Composio & LobehubSkill)
 * For string type icon, use Image component to render
 * For IconType type icon, use Icon component to render with theme fill color
 */
const BuiltinToolIcon = memo<Pick<ComposioAppType | LobehubSkillProviderType, 'icon' | 'label'>>(
  ({ icon, label }) => {
    if (typeof icon === 'string') {
      return <Image alt={label} height={40} src={icon} style={{ flex: 'none' }} width={40} />;
    }

    // Use theme color fill, automatically adapts in dark mode
    return <Icon fill={cssVar.colorText} icon={icon} size={40} />;
  },
);

BuiltinToolIcon.displayName = 'BuiltinToolIcon';

const styles = stylex.create({
  clickable: { cursor: 'pointer' },
  desc: { flex: '1', margin: '0', fontSize: '14px', color: cssVar.colorTextSecondary },
  noLink: { cursor: 'default' },
  tag: { flexShrink: 0 },
  title: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 500,
    color: { default: null, [stylex.when.ancestor(':hover')]: cssVar.colorLink },
  },
  titleRow: { display: 'flex', gap: '8px', alignItems: 'center' },
});

interface PluginItemProps {
  identifier: string;
}

const PluginItem = memo<PluginItemProps>(({ identifier }) => {
  const { t } = useTranslation('discover');
  const usePluginDetail = useDiscoverStore((s) => s.useFetchPluginDetail);
  const { isLoading, queryKey } = usePluginDetail({ identifier, withManifest: false });
  // The replica view of this identifier; the sync hook only reports the fetch flags.
  const apiData = useDiscoverStore(pluginSelectors.pluginDetail(queryKey));

  // Try to get Composio tool info if API returns no data
  const composioTool = useMemo(() => {
    return COMPOSIO_APP_TYPES.find((tool) => tool.identifier === identifier);
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

    // Check Composio tools
    if (composioTool) {
      return {
        author: 'Composio',
        avatar: '', // Avatar will be rendered by BuiltinToolIcon component
        category: undefined,
        createdAt: '',
        description: `LobeHub Mcp Server: ${composioTool.label}`,
        homepage: 'https://composio.dev',
        identifier: composioTool.identifier,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin' as const,
        tags: ['composio', 'mcp'],
        title: composioTool.label,
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
        homepage: lobehubSkill.authorUrl || OFFICIAL_SITE,
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
        avatar: builtinTool.avatar || '',
        category: undefined,
        createdAt: '',
        description: builtinTool.description || '',
        homepage: OFFICIAL_SITE,
        identifier: builtinTool.identifier,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin' as const,
        tags: builtinTool.tags || ['builtin-tool'],
        title: builtinTool.title || builtinTool.identifier,
      };
    }

    return undefined;
  }, [apiData, composioTool, lobehubSkill, builtinTool]);

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
      <Block horizontal gap={12} key={identifier} padding={12} variant={'outlined'}>
        <Skeleton.Text rows={1} />
      </Block>
    );

  // If loading is complete but no data found, don't render anything
  if (!data) return null;

  // Render avatar - use BuiltinToolIcon for built-in tools, Avatar for others
  const renderAvatar = () => {
    if (composioTool) {
      return <BuiltinToolIcon icon={composioTool.icon} label={composioTool.label} />;
    }
    if (lobehubSkill) {
      return <BuiltinToolIcon icon={lobehubSkill.icon} label={lobehubSkill.label} />;
    }
    return <Avatar avatar={data.avatar} shape={'square'} size={40} style={{ flex: 'none' }} />;
  };

  const content = (
    <Block
      horizontal
      gap={12}
      key={identifier}
      padding={12}
      variant={'outlined'}
      className={
        stylex.props(
          sourceConfig.clickable ? [styles.clickable, stylex.defaultMarker()] : styles.noLink,
        ).className
      }
    >
      {renderAvatar()}
      <Flexbox
        flex={1}
        gap={6}
        style={{
          overflow: 'hidden',
        }}
      >
        <div {...stylex.props(styles.titleRow)}>
          <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
            {data.title}
          </Text>
          {sourceConfig.tagText && (
            <Tag
              className={stylex.props(styles.tag).className}
              color={sourceConfig.tagColor}
              size={'small'}
            >
              {sourceConfig.tagText}
            </Tag>
          )}
        </div>
        <Text
          as={'p'}
          className={stylex.props(styles.desc).className}
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
    return <WorkspaceLink to={sourceConfig.href}>{content}</WorkspaceLink>;
  }

  return content;
});

export default PluginItem;
