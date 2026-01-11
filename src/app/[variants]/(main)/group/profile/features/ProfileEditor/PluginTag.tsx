'use client';

import { KLAVIS_SERVER_TYPES, type KlavisServerType } from '@lobechat/const';
import { Avatar, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { AlertCircle, X } from 'lucide-react';
import Image from 'next/image';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
 * Klavis 服务器图标组件
 */
const KlavisIcon = memo<Pick<KlavisServerType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return (
      <Image alt={label} height={16} src={icon} style={{ flexShrink: 0 }} unoptimized width={16} />
    );
  }

  return <Icon fill={cssVar.colorText} icon={icon} size={16} />;
});

const styles = createStaticStyles(({ css, cssVar }) => ({
  notInstalledTag: css`
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  tag: css`
    height: 28px !important;
    border-radius: ${cssVar.borderRadiusSM}px !important;
  `,
  warningIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
  `,
}));

interface PluginTagProps {
  onRemove: (e: React.MouseEvent) => void;
  pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> };
}

const PluginTag = memo<PluginTagProps>(({ pluginId, onRemove }) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('setting');

  // Extract identifier
  const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;

  // Get local plugin lists
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  // Klavis 相关状态
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
        // Check if this Klavis server is connected
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
    if (!meta.isInstalled) {
      return <AlertCircle className={styles.warningIcon} size={14} />;
    }

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
      className={styles.tag}
      closable
      closeIcon={<X size={12} />}
      color={meta.isInstalled ? undefined : 'error'}
      icon={renderIcon()}
      onClose={onRemove}
      title={
        meta.isInstalled
          ? undefined
          : t('tools.notInstalledWarning', { defaultValue: 'This tool is not installed' })
      }
      variant={isDarkMode ? 'filled' : 'outlined'}
    >
      {!meta.isInstalled
        ? `${displayTitle} (${t('tools.notInstalled', { defaultValue: 'Not Installed' })})`
        : displayTitle}
    </Tag>
  );
});

PluginTag.displayName = 'PluginTag';

export default PluginTag;
