'use client';

import { type ComposioAppType, type LobehubSkillProviderType } from '@lobechat/const';
import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { AlertCircle, Loader2, Square, SquareCheckBig, X } from 'lucide-react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useIsDark } from '@/hooks/useIsDark';
import { useDiscoverStore } from '@/store/discover';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';

/**
 * Composio server icon component
 */
const ComposioIcon = memo<Pick<ComposioAppType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <img alt={label} height={16} src={icon} style={{ flexShrink: 0 }} width={16} />;
  }

  return <Icon fill={cssVar.colorText} icon={icon} size={16} />;
});

/**
 * LobeHub Skill Provider icon component
 */
const LobehubSkillIcon = memo<Pick<LobehubSkillProviderType, 'icon' | 'label'>>(
  ({ icon, label }) => {
    if (typeof icon === 'string') {
      return <img alt={label} height={16} src={icon} style={{ flexShrink: 0 }} width={16} />;
    }

    return <Icon fill={cssVar.colorText} icon={icon} size={16} />;
  },
);

// Stable empty reference for the connector-list read when attribution is off,
// so `showAuthor={false}` tags never subscribe to connector list changes.
const EMPTY_CONNECTORS: ReturnType<typeof connectorSelectors.connectorList> = [];
const emptyConnectorList = () => EMPTY_CONNECTORS;

const styles = createStaticStyles(({ css, cssVar }) => ({
  loadingIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    animation: spin 1s linear infinite;

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }
  `,
  notInstalledTag: css`
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  tag: css`
    height: 28px !important;
    border-radius: ${cssVar.borderRadiusSM} !important;
  `,
  warningIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
  `,
}));

export interface PluginTagProps {
  /**
   * When set, an identifier owned/mounted by this agent resolves as installed
   * (agent connectors live on the agent's own rows, not the user's stores),
   * so an agent-exclusive connector doesn't render as "Not Installed".
   */
  agentId?: string;
  disabled?: boolean;
  onRemove?: (e: React.MouseEvent) => void;
  /** Fires when the checkbox/tag is toggled in `selectable` mode. */
  onSelect?: () => void;
  pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> };
  /**
   * Whether the remove (×) button is shown. Default true. Set false to keep the
   * tag interactive (clickable to open detail) while hiding removal — e.g. a
   * shared workspace connector the current member isn't allowed to delete
   * (only its creator or a workspace owner can).
   */
  removable?: boolean;
  /**
   * Render as a selectable chip: a leading checkbox, no remove (×) button, and
   * the whole tag toggles selection. Used by the multi-select "copy" flow.
   */
  selectable?: boolean;
  /** Selection state in `selectable` mode. */
  selected?: boolean;
  /**
   * Show a trailing avatar attributing the connector to the member who
   * authorized it ("authorized by X"). Resolved from the connector rows in the
   * store (agent-scoped row when `agentId` is set, else the base/workspace row).
   * Only meaningful in a workspace — callers pass it when several members may
   * share the agent, so a teammate can see WHOSE credentials a tool runs under.
   * @default false
   */
  showAuthor?: boolean;
  /**
   * Whether to show "Desktop Only" label for tools not available in web
   * @default false
   */
  showDesktopOnlyLabel?: boolean;
  /**
   * Whether to use allMetaList (includes hidden tools) or metaList
   * @default false
   */
  useAllMetaList?: boolean;
}

const PluginTag = memo<PluginTagProps>(
  ({
    agentId,
    pluginId,
    onRemove,
    onSelect,
    removable = true,
    selectable = false,
    selected = false,
    disabled,
    showAuthor = false,
    showDesktopOnlyLabel = false,
    useAllMetaList = false,
  }) => {
    const isDarkMode = useIsDark();
    const { t } = useTranslation('setting');

    // Extract identifier
    const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;

    // Agent-scoped connectors (empty unless agentId is provided).
    const agentConnectors = useToolStore(
      connectorSelectors.agentConnectors(agentId ?? ''),
      isEqual,
    );

    // Base/workspace connector rows — used to attribute a tool to its authorizing
    // member. Only read when `showAuthor` so non-attributing call sites don't
    // re-render on connector list changes.
    const connectorList = useToolStore(
      showAuthor ? connectorSelectors.connectorList : emptyConnectorList,
      isEqual,
    );

    // The member who authorized this connector: prefer the agent-scoped row
    // (agent dimension) over the base/workspace row. `null` when not attributable
    // (builtin tool, remote plugin, or attribution disabled).
    const author = useMemo(() => {
      if (!showAuthor) return null;
      const row =
        (agentId ? agentConnectors.find((c) => c.identifier === identifier) : undefined) ??
        connectorList.find((c) => c.identifier === identifier);
      if (!row?.authorizedByName) return null;
      return { avatar: row.authorizedByAvatar ?? undefined, name: row.authorizedByName };
    }, [showAuthor, agentId, agentConnectors, connectorList, identifier]);

    // Get local plugin lists - use allMetaList or metaList based on prop
    const builtinList = useToolStore(
      useAllMetaList ? builtinToolSelectors.allMetaList : builtinToolSelectors.metaList,
      isEqual,
    );
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

    // Composio-related state
    const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
    const isComposioEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableComposio);

    // LobeHub Skill-related state
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

    // Custom connector state
    const customConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);

    // Check if plugin is installed
    const isInstalled = useToolStore(pluginSelectors.isPluginInstalled(identifier));

    // Try to find in local lists first (including Composio and LobehubSkill)
    const localMeta = useMemo(() => {
      // Agent-owned/mounted connector: resolve as installed even though it isn't
      // in the user-scoped stores. The icon still comes from the normal
      // resolution below (composio/lobehub/builtin/plugin), with an MCP fallback
      // at the end for an agent-only connector absent from every user list.
      const agentConn = agentId
        ? agentConnectors.find((c) => c.identifier === identifier)
        : undefined;
      const agentInstalled = !!agentConn;

      // Check if it's a Composio server type
      if (isComposioEnabledInEnv) {
        const composioType = COMPOSIO_APP_TYPES.find((type) => type.identifier === identifier);
        if (composioType) {
          // Check if this Composio server is connected
          const connectedServer = allComposioServers.find((s) => s.identifier === identifier);
          return {
            availableInWeb: true,
            icon: composioType.icon,
            isInstalled: !!connectedServer || agentInstalled,
            label: composioType.label,
            title: composioType.label,
            type: 'composio' as const,
          };
        }
      }

      // Check if it's a LobeHub Skill provider
      if (isLobehubSkillEnabled) {
        const lobehubSkillProvider = LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === identifier);
        if (lobehubSkillProvider) {
          // Check if this LobehubSkill provider is connected
          const connectedServer = allLobehubSkillServers.find((s) => s.identifier === identifier);
          return {
            availableInWeb: true,
            icon: lobehubSkillProvider.icon,
            isInstalled: !!connectedServer || agentInstalled,
            label: lobehubSkillProvider.label,
            title: lobehubSkillProvider.label,
            type: 'lobehub-skill' as const,
          };
        }
      }

      // Check if it's a custom connector
      const customConnector = customConnectors.find((c) => c.identifier === identifier);
      if (customConnector) {
        return {
          availableInWeb: true,
          icon: McpIcon,
          isInstalled: true,
          label: customConnector.name || customConnector.identifier,
          title: customConnector.name || customConnector.identifier,
          type: 'custom-connector' as const,
        };
      }

      const builtinMeta = builtinList.find((p) => p.identifier === identifier);
      if (builtinMeta) {
        // availableInWeb is only present when using allMetaList
        const availableInWeb =
          useAllMetaList && 'availableInWeb' in builtinMeta
            ? (builtinMeta as LobeToolMetaWithAvailability).availableInWeb
            : true;
        return {
          availableInWeb,
          avatar: builtinMeta.meta.avatar,
          isInstalled: true,
          title: builtinMeta.meta.title,
          type: 'builtin' as const,
        };
      }

      const installedMeta = installedPluginList.find((p) => p.identifier === identifier);
      if (installedMeta) {
        return {
          availableInWeb: true,
          avatar: installedMeta.avatar,
          isInstalled: true,
          title: installedMeta.title,
          type: 'plugin' as const,
        };
      }

      // Agent-only connector not found in any user store: use its own row + MCP
      // icon so it renders installed (not a warning "Not Installed" chip).
      if (agentConn) {
        return {
          availableInWeb: true,
          icon: McpIcon,
          isInstalled: true,
          label: agentConn.name || identifier,
          title: agentConn.name || identifier,
          type: 'custom-connector' as const,
        };
      }

      return null;
    }, [
      identifier,
      agentId,
      agentConnectors,
      builtinList,
      installedPluginList,
      isComposioEnabledInEnv,
      allComposioServers,
      isLobehubSkillEnabled,
      allLobehubSkillServers,
      customConnectors,
      useAllMetaList,
    ]);

    // Fetch from remote if not found locally
    const usePluginDetail = useDiscoverStore((s) => s.usePluginDetail);
    const { data: remoteData, isLoading } = usePluginDetail({
      identifier: !localMeta && !isInstalled ? identifier : undefined,
      withManifest: false,
    });

    // Determine final metadata
    const meta = localMeta || {
      availableInWeb: true,
      avatar: remoteData?.avatar,
      isInstalled: false,
      title: remoteData?.title || identifier,
      type: 'plugin' as const,
    };

    // Use identifier as title when loading, otherwise use meta.title
    const displayTitle = meta.title;
    const isDesktopOnly = showDesktopOnlyLabel && !meta.availableInWeb;

    // Render icon based on type
    const renderIcon = () => {
      // Show loading spinner when loading
      if (isLoading) {
        return <Loader2 className={styles.loadingIcon} size={14} />;
      }

      // Show warning icon when not installed
      if (!meta.isInstalled) {
        return <AlertCircle className={styles.warningIcon} size={14} />;
      }

      // Composio type has icon property
      if (meta.type === 'composio' && 'icon' in meta && 'label' in meta) {
        return <ComposioIcon icon={meta.icon} label={meta.label} />;
      }

      // LobeHub Skill type has icon property
      if (meta.type === 'lobehub-skill' && 'icon' in meta && 'label' in meta) {
        return <LobehubSkillIcon icon={meta.icon} label={meta.label} />;
      }

      // Custom connector type
      if (meta.type === 'custom-connector') {
        return <Icon fill={cssVar.colorText} icon={McpIcon} size={16} />;
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

    // Build display text
    const getDisplayText = () => {
      let text = displayTitle;
      if (isDesktopOnly) {
        text += ` (${t('tools.desktopOnly', { defaultValue: 'Desktop Only' })})`;
      }
      // Don't show "Not Installed" when loading
      if (!meta.isInstalled && !isLoading) {
        text += ` (${t('tools.notInstalled', { defaultValue: 'Not Installed' })})`;
      }
      return text;
    };

    // Only show error state when not installed and not loading
    const showErrorState = !meta.isInstalled && !isLoading;

    return (
      <Tag
        className={styles.tag}
        closable={removable && !disabled && !selectable}
        closeIcon={<X size={12} />}
        color={showErrorState ? 'error' : undefined}
        style={selectable ? { cursor: 'pointer' } : undefined}
        variant={isDarkMode ? 'filled' : 'outlined'}
        icon={
          selectable ? (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon
                icon={selected ? SquareCheckBig : Square}
                size={14}
                style={{ color: selected ? cssVar.colorPrimary : cssVar.colorTextQuaternary }}
              />
              {renderIcon()}
            </Flexbox>
          ) : (
            renderIcon()
          )
        }
        title={
          showErrorState
            ? t('tools.notInstalledWarning', { defaultValue: 'This tool is not installed' })
            : undefined
        }
        onClick={selectable ? onSelect : undefined}
        onClose={(e) => {
          if (disabled) return;

          onRemove?.(e);
        }}
      >
        {author ? (
          <Flexbox horizontal align={'center'} gap={4}>
            {getDisplayText()}
            <Tooltip title={t('settingAgent.agentTools.authorizedBy', { name: author.name })}>
              <Avatar
                avatar={author.avatar}
                size={16}
                style={{ flexShrink: 0 }}
                title={author.name}
              />
            </Tooltip>
          </Flexbox>
        ) : (
          getDisplayText()
        )}
      </Tag>
    );
  },
);

PluginTag.displayName = 'PluginTag';

export default PluginTag;
