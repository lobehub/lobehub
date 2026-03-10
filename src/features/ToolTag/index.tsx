'use client';

import { type KlavisServerType } from '@lobechat/const';
import { KLAVIS_SERVER_TYPES } from '@lobechat/const';
import { Avatar, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useIsDark } from '@/hooks/useIsDark';
import { useDiscoverStore } from '@/store/discover';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

/**
 * Klavis server icon component
 */
const KlavisIcon = memo<Pick<KlavisServerType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <img alt={label} height={16} src={icon} style={{ flexShrink: 0 }} width={16} />;
  }

  return <Icon fill={cssVar.colorText} icon={icon} size={16} />;
});

const styles = createStaticStyles(({ css, cssVar }) => ({
  compact: css`
    height: auto !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
  `,
  tag: css`
    height: 24px !important;
    border-radius: ${cssVar.borderRadiusSM} !important;
  `,
}));

export interface ToolTagProps {
  /**
   * The tool identifier to display
   */
  identifier: string;
  /**
   * Variant style of the tag
   * - 'default': normal tag with background and border
   * - 'compact': no padding, no background, no border (text only with icon)
   * @default 'default'
   */
  variant?: 'compact' | 'default';
}

/**
 * A readonly tag component that displays tool information based on identifier.
 * Unlike PluginTag, this component is not closable and is designed for display-only purposes.
 */
const ToolTag = memo<ToolTagProps>(({ identifier, variant = 'default' }) => {
  const isDarkMode = useIsDark();
  const isCompact = variant === 'compact';

  // Get local plugin lists
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  // Klavis related state
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // Check if plugin is installed
  const isInstalled = useToolStore(pluginSelectors.isPluginInstalled(identifier));

  // Try to find in local lists first (including Klavis)
  const localMeta = useMemo(() => {
    // Check if it's a Klavis server type
    if (isKlavisEnabledInEnv) {
      const klavisType = KLAVIS_SERVER_TYPES.find((type) => type.identifier === identifier);
      if (klavisType) {
        const connectedServer = allKlavisServers.find((s) => s.identifier === identifier);
        return {
          icon: klavisType.icon,
          isInstalled: !!connectedServer,
          label: klavisType.label,
          title: klavisType.label,
          type: 'klavis' as const,
        };
      }
    }

    const builtinMeta = builtinList.find((p) => p.identifier === identifier);
    if (builtinMeta) {
      return {
        avatar: builtinMeta.meta.avatar,
        isInstalled: true,
        title: builtinMeta.meta.title,
        type: 'builtin' as const,
      };
    }

    const installedMeta = installedPluginList.find((p) => p.identifier === identifier);
    if (installedMeta) {
      return {
        avatar: installedMeta.avatar,
        isInstalled: true,
        title: installedMeta.title,
        type: 'plugin' as const,
      };
    }

    return null;
  }, [identifier, builtinList, installedPluginList, isKlavisEnabledInEnv, allKlavisServers]);

  // Fetch from remote if not found locally
  const usePluginDetail = useDiscoverStore((s) => s.usePluginDetail);
  const { data: remoteData, isLoading } = usePluginDetail({
    identifier: !localMeta && !isInstalled ? identifier : undefined,
    withManifest: false,
  });

  // Determine final metadata
  const meta = localMeta || {
    avatar: remoteData?.avatar,
    isInstalled: false,
    title: remoteData?.title || identifier,
    type: 'plugin' as const,
  };

  const displayTitle = isLoading ? 'Loading...' : meta.title;

  // Render icon based on type
  const renderIcon = () => {
    // Klavis type has icon property
    if (meta.type === 'klavis' && 'icon' in meta && 'label' in meta) {
      return <KlavisIcon icon={meta.icon} label={meta.label} />;
    }

    // Builtin type has avatar
    if (meta.type === 'builtin' && 'avatar' in meta && meta.avatar) {
      return <Avatar avatar={meta.avatar} shape={'square'} size={16} style={{ flexShrink: 0 }} />;
    }

    // Plugin type
    if ('avatar' in meta) {
      return <PluginAvatar avatar={meta.avatar} size={16} />;
    }

    return null;
  };

  return (
    <Tag
      className={isCompact ? styles.compact : styles.tag}
      icon={renderIcon()}
      variant={isCompact ? 'borderless' : isDarkMode ? 'filled' : 'outlined'}
    >
      {displayTitle}
    </Tag>
  );
});

ToolTag.displayName = 'ToolTag';

export default ToolTag;
