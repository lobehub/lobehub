import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { isOnDemandBuiltinTool } from '@lobechat/builtin-tools';
import { getConnectorCatalog } from '@lobechat/const';
import {
  parsePluginEntry,
  resolveToolMode,
  setBuiltinPluginMode,
  upsertConnectorEnabled,
  upsertPluginMode,
} from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';
import { Avatar, confirmModal, Icon, Popover, Tag, Tooltip } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import {
  BadgeCheck,
  Ban,
  Check,
  MoreHorizontal,
  Package,
  Settings,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { useConnectorConfigure } from '@/features/Connectors/CustomConnectorModal/useConnectorConfigure';
import { openPluginEditModal } from '@/features/PluginDevModal/imperative';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { closeToolDetailPopovers } from '../components/useDetailPopoverState';
import { MemoryEffortControl } from '../Memory/Controls';
import { useMemoryEnabled } from '../Memory/useMemoryEnabled';
import { SearchAdvancedControls } from '../Search/Controls';
import { useAgentMenuConnectors, useUnpinDeletedConnector } from './agentMenuConnectors';
import { isCapabilityTool, resolveCapabilityConfigPatch } from './capabilityTools';
import ComposioServerItem from './ComposioServerItem';
import ComposioSkillIcon from './ComposioSkillIcon';
import { SKILL_ICON_SIZE } from './constants';
import { resolveImplicitMode } from './librarySkillPolicy';
import LobehubSkillIcon from './LobehubSkillIcon';
import LobehubSkillServerItem from './LobehubSkillServerItem';
import PrivateConnectorTag from './PrivateConnectorTag';
import SkillRow from './SkillRow';
import ToolItemDetailPopover from './ToolItemDetailPopover';
import { ToolPickerHeader } from './ToolPickerHeader';
import { useActivationSets } from './useActivationSets';
import { styles } from './useControls.styles';
import { usePluginRowUninstall } from './usePluginRowUninstall';

const officialTag = (
  <Tooltip placement={'top'} title={'LobeHub'}>
    <Tag color={'success'} icon={<Icon icon={BadgeCheck} />} size={'small'} />
  </Tooltip>
);

type SkillPolicyMode = 'auto' | 'disabled';

// Capability rows offer the same three states as any other skill row. A model whose
// built-in search can never be turned off has no Disabled state to offer — the write
// would be overridden by the runtime — so its search row keeps Pinned/Auto only.
const CAPABILITY_MODES: SkillPolicyMode[] = ['auto', 'disabled'];
const CAPABILITY_MODES_WITHOUT_DISABLE: SkillPolicyMode[] = ['auto'];

interface SkillDeleteConfig {
  displayName: string;
  onDelete: () => Promise<void> | void;
}

interface SkillConfigureConfig {
  onConfigure: () => void;
}

interface SkillPolicyMenuOptions {
  configureConfig?: SkillConfigureConfig;
  /**
   * @default 'auto'
   */
  defaultMode?: SkillPolicyMode;
  deleteConfig?: SkillDeleteConfig;
  /**
   * Hide the activation options and show only the configure/delete actions. Used
   * for integrations that exist but aren't connected yet (pending auth /
   * re-authorize), where activation is meaningless but the user still needs a way
   * to remove the entry.
   */
  deleteOnly?: boolean;
  /**
   * Activation state for rows whose on/off is NOT stored in `agents.plugins` —
   * memory and web search derive it from chatConfig, so reading the plugin list
   * would report the wrong state for them.
   */
  modeOverride?: SkillPolicyMode;
  /**
   * Capability settings rendered under the activation options (e.g. the memory
   * effort level), so a capability row keeps its tuning after leaving the "+"
   * menu. The block owns the separator above itself and renders nothing when it
   * has nothing to show, so the panel never keeps a divider over empty space.
   */
  panelExtra?: ReactNode;
  /**
   * @default ['auto', 'disabled']
   */
  supportedModes?: SkillPolicyMode[];
}

type SkillMenuItem = NonNullable<ItemType> & {
  extra?: ReactNode;
  popoverContent?: ReactNode;
  searchText?: string;
  canDisable?: boolean;
  optionTitle?: ReactNode;
  optionIcon?: ReactNode;
  detailContent?: ReactNode;
};

export const useControls = ({ closeDropdown }: { closeDropdown?: () => void } = {}) => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const navigate = useWorkspaceAwareNavigate();
  const { updateAgentConfig } = useUpdateAgentConfig();
  const [filter, setFilter] = useState<SkillPolicyMode>('auto');
  const [policyOpenId, setPolicyOpenId] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const list = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const uninstallPluginRow = usePluginRowUninstall();
  const [removeComposioConnection, deleteConnector] = useToolStore((s) => [
    s.removeComposioConnection,
    s.deleteConnector,
  ]);
  const rawPlugins = useAgentStore(
    (s) => agentByIdSelectors.getAgentConfigById(agentId)(s)?.plugins,
  );
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const discoverBuiltins = useAgentStore(
    (s) =>
      resolveToolMode(agentByIdSelectors.getAgentConfigById(agentId)(s)?.chatConfig) === 'agent',
  );
  const { connectorIds, disabledIdSet, optInIds } = useActivationSets(
    agentId,
    rawPlugins,
    discoverBuiltins,
  );
  const builtinList = useToolStore(builtinToolSelectors.metaListIncludingHidden, isEqual);

  // Memory and web browsing are runtime-managed builtin tools: `hidden` keeps them
  // out of `metaList`, and the shared engine rules force their enabled state from
  // chatConfig rather than from `agents.plugins`. They still belong in the Tools
  // popover's activation list, so their policy is derived from — and written back
  // to — that same chatConfig. One source of truth keeps every other reader of it
  // (memory injection, the search wiring) in agreement with this list.
  const isMemoryCapabilityEnabled = useMemoryEnabled(agentId);
  const { model, provider } = useEffectiveModel(agentId);
  const searchMode = useAgentStore((s) => chatConfigByIdSelectors.getSearchModeById(agentId)(s));
  const isModelBuiltinSearchInternal = useAiInfraStore(
    aiModelSelectors.isModelBuiltinSearchInternal(model, provider),
  );
  // A model whose built-in search can never be turned off has no Disabled state to
  // offer — the action would write a config the runtime keeps overriding.
  const isSearchCapabilityEnabled = isModelBuiltinSearchInternal || searchMode !== 'off';
  const searchCapabilityModes = isModelBuiltinSearchInternal
    ? CAPABILITY_MODES_WITHOUT_DISABLE
    : CAPABILITY_MODES;
  const disabledCapabilityIds = useMemo(() => {
    const ids = new Set<string>();
    if (!isMemoryCapabilityEnabled) ids.add(MemoryManifest.identifier);
    if (!isSearchCapabilityEnabled) ids.add(WebBrowsingManifest.identifier);
    return ids;
  }, [isMemoryCapabilityEnabled, isSearchCapabilityEnabled]);

  const updateSkillPolicy = useCallback(
    async (id: string, mode: SkillPolicyMode) => {
      if (!canEdit || !agentId) return;
      const state = useAgentStore.getState();
      const plugins = agentByIdSelectors.getAgentConfigById(agentId)(state)?.plugins;
      const patch = isCapabilityTool(id) ? resolveCapabilityConfigPatch(id, mode) : undefined;
      if (patch) {
        // Capabilities have their own source of truth. Remove any old plugin
        // override in the same write, without touching unrelated choices.
        const hasLegacyEntry = plugins?.some((entry) => parsePluginEntry(entry).identifier === id);
        await updateAgentConfig({
          chatConfig: patch,
          ...(hasLegacyEntry && { plugins: upsertPluginMode(plugins, id, 'auto') }),
        });
      } else {
        await updateAgentConfig({
          plugins: isOnDemandBuiltinTool(id)
            ? setBuiltinPluginMode(plugins, id, mode)
            : connectorIds.has(id)
              ? upsertConnectorEnabled(plugins, id, mode === 'auto')
              : upsertPluginMode(
                  plugins,
                  id,
                  mode,
                  mode === 'auto' && !discoverBuiltins
                    ? 'disabled'
                    : resolveImplicitMode(id, optInIds),
                ),
        });
      }
    },
    [agentId, canEdit, connectorIds, discoverBuiltins, optInIds, updateAgentConfig],
  );

  const openSkillPolicyMenu = useCallback((id: string) => {
    closeToolDetailPopovers();
    setPolicyOpenId(id);
  }, []);

  const renderPolicyMenu = useCallback(
    (id: string, options: SkillPolicyMenuOptions = {}) => {
      const {
        configureConfig,
        defaultMode = 'auto',
        deleteConfig,
        deleteOnly = false,
        modeOverride,
        panelExtra,
        supportedModes = CAPABILITY_MODES,
      } = options;
      const mode: SkillPolicyMode =
        modeOverride ?? (disabledIdSet.has(id) ? 'disabled' : defaultMode);
      const renderCheck = (value: SkillPolicyMode) =>
        mode === value ? (
          <span {...stylex.props(styles.policyCheck)}>
            <Icon icon={Check} size={14} />
          </span>
        ) : (
          <span {...stylex.props(styles.policyCheck)} />
        );

      // Right-click / "..." menu is an action list (Pin / Auto / Disable), not a
      // status readout — group headers still use the state labels below.
      // `as const` keeps literal keys so `t()` stays typed against setting resources.
      const policyActionKey = {
        auto: 'tools.loading.onDemand',
        disabled: 'tools.loading.never',
      } as const satisfies Record<SkillPolicyMode, string>;

      const renderPolicyItem = (value: SkillPolicyMode, icon: ReactNode) => (
        <button
          {...stylex.props(styles.policyItem)}
          disabled={!canEdit}
          type="button"
          onClick={async (event) => {
            event.stopPropagation();
            if (!canEdit) return;
            setPolicyOpenId(null);
            await updateSkillPolicy(id, value);
          }}
        >
          <span {...stylex.props(styles.policyItemIcon)}>{icon}</span>
          <span {...stylex.props(styles.policyText)}>{t(policyActionKey[value])}</span>
          {renderCheck(value)}
        </button>
      );

      const content = (
        <div
          {...stylex.props(styles.policyPanel, Boolean(panelExtra) && styles.policyPanelWide)}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {!deleteOnly &&
            supportedModes.includes('auto') &&
            renderPolicyItem(
              'auto',
              <Icon
                icon={Zap}
                size={15}
                className={
                  stylex.props(mode === 'auto' ? styles.iconAuto : styles.iconDefault).className
                }
              />,
            )}
          {!deleteOnly &&
            supportedModes.includes('disabled') &&
            renderPolicyItem(
              'disabled',
              <Icon
                icon={Ban}
                size={15}
                className={
                  stylex.props(mode === 'disabled' ? styles.iconDisabled : styles.iconDefault)
                    .className
                }
              />,
            )}
          {!deleteOnly && (configureConfig || deleteConfig) && (
            <div {...stylex.props(styles.deleteDivider)} />
          )}
          {configureConfig && (
            <button
              {...stylex.props(styles.policyItem)}
              disabled={!canEdit}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!canEdit) return;
                setPolicyOpenId(null);
                configureConfig.onConfigure();
              }}
            >
              <span {...stylex.props(styles.policyItemIcon)}>
                <Icon icon={Wrench} size={15} />
              </span>
              <span {...stylex.props(styles.policyText)}>{t('tools.builtins.configure')}</span>
            </button>
          )}
          {deleteConfig && (
            <button
              {...stylex.props(styles.deleteButton)}
              disabled={!canEdit}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!canEdit) return;
                setPolicyOpenId(null);
                confirmModal({
                  content: t('tools.builtins.uninstallConfirm.desc', {
                    name: deleteConfig.displayName,
                  }),
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    await deleteConfig.onDelete();
                  },
                  title: t('tools.builtins.uninstallConfirm.title', {
                    name: deleteConfig.displayName,
                  }),
                });
              }}
            >
              <span {...stylex.props(styles.policyItemIcon)}>
                <Icon
                  className={stylex.props(styles.deleteIcon).className}
                  icon={Trash2}
                  size={15}
                />
              </span>
              <span {...stylex.props(styles.policyText)}>{t('tools.builtins.uninstall')}</span>
            </button>
          )}
          {panelExtra}
        </div>
      );

      return (
        <Popover
          arrow={false}
          content={content}
          open={policyOpenId === id}
          placement="rightTop"
          positionerProps={{ sideOffset: 8 }}
          styles={{ content: { padding: 0 } }}
          trigger="click"
          onOpenChange={(open) => (open ? openSkillPolicyMenu(id) : setPolicyOpenId(null))}
        >
          <button
            aria-label={t('tools.skillActivateMode.title')}
            {...stylex.props(styles.policyButton)}
            disabled={!canEdit}
            type="button"
            onPointerEnter={closeToolDetailPopovers}
            onClick={(event) => {
              event.stopPropagation();
              closeToolDetailPopovers();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openSkillPolicyMenu(id);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              closeToolDetailPopovers();
            }}
          >
            <Icon icon={MoreHorizontal} size={15} />
          </button>
        </Popover>
      );
    },
    [canEdit, disabledIdSet, openSkillPolicyMenu, policyOpenId, t, updateSkillPolicy],
  );

  const renderToolLabel = useCallback(
    (
      id: string,
      label: ReactNode,
      action: ReactNode,
      badge?: ReactNode,
      icon?: ReactNode,
      extraTag?: ReactNode,
      detailContent?: ReactNode,
    ) => (
      <SkillRow
        className={stylex.props(styles.toolRow, stylex.defaultMarker()).className}
        detailContent={detailContent}
        detailDisabled={policyOpenId !== null}
        labelClassName={stylex.props(styles.toolLabel).className}
        label={
          <>
            {icon}
            <span {...stylex.props(styles.toolLabelBody)}>
              <span {...stylex.props(styles.toolLabelText)}>{label}</span>
              {extraTag}
            </span>
          </>
        }
        trailing={
          <>
            {badge && <span {...stylex.props(styles.typeTag)}>{badge}</span>}
            {action}
          </>
        }
        trailingClassName={
          stylex.props(styles.toolTrailing, policyOpenId === id && styles.toolTrailingVisible)
            .className
        }
        onContextMenu={() => openSkillPolicyMenu(id)}
      />
    ),
    [openSkillPolicyMenu, policyOpenId],
  );

  const createManagedSkillItem = useCallback(
    ({
      badge,
      configureConfig,
      defaultMode,
      deleteConfig,
      extraTag,
      icon,
      id,
      modeOverride,
      panelExtra,
      popoverContent,
      searchText,
      supportedModes,
      title,
    }: {
      badge?: ReactNode;
      configureConfig?: SkillConfigureConfig;
      defaultMode?: SkillPolicyMode;
      deleteConfig?: SkillDeleteConfig;
      extraTag?: ReactNode;
      icon: ReactNode;
      id: string;
      modeOverride?: SkillPolicyMode;
      panelExtra?: ReactNode;
      popoverContent?: ReactNode;
      searchText?: string;
      supportedModes?: SkillPolicyMode[];
      title: ReactNode;
    }): SkillMenuItem =>
      ({
        optionTitle: title,
        optionIcon: icon,
        detailContent: popoverContent,
        canDisable: !supportedModes || supportedModes.includes('disabled'),
        closeOnClick: false,
        key: id,
        label: renderToolLabel(
          id,
          title,
          renderPolicyMenu(id, {
            configureConfig,
            defaultMode,
            deleteConfig,
            modeOverride,
            panelExtra,
            supportedModes,
          }),
          badge,
          icon,
          extraTag,
          popoverContent,
        ),
        searchText: searchText || String(title || id),
      }) as SkillMenuItem,
    [renderPolicyMenu, renderToolLabel],
  );

  // Composio-related state
  const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const isComposioEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableComposio);

  // LobeHub Skill related state
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  // Agent Skills related state
  const installedBuiltinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);

  // MCP connectors the user added that this agent loads (custom and marketplace)
  const customConnectors = useAgentMenuConnectors(agentId);
  // A deleted connector's switch turns off, unless the agent still loads a row of it
  const unpinDeleted = useUnpinDeletedConnector(agentId, (identifier) =>
    updateSkillPolicy(identifier, 'disabled'),
  );
  const getConfigure = useConnectorConfigure();
  const [
    useFetchUserComposioConnections,
    useFetchLobehubSkillConnections,
    useFetchUninstalledBuiltinTools,
    useFetchAgentSkills,
  ] = useToolStore((s) => [
    s.useFetchUserComposioConnections,
    s.useFetchLobehubSkillConnections,
    s.useFetchUninstalledBuiltinTools,
    s.useFetchAgentSkills,
  ]);

  useFetchInstalledPlugins();
  useFetchUninstalledBuiltinTools(true);
  useFetchAgentSkills(true);

  // Load user's Composio integrations via SWR (from database)
  useFetchUserComposioConnections(isComposioEnabledInEnv);

  // Load user's LobeHub Skill connections via SWR
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);

  const connectorCatalog = useMemo(
    () =>
      getConnectorCatalog({
        composio: isComposioEnabledInEnv,
        lobehub: isLobehubSkillEnabled,
      }),
    [isComposioEnabledInEnv, isLobehubSkillEnabled],
  );
  const connectorIdentifiers = useMemo(
    () =>
      new Set(
        connectorCatalog.map((item) =>
          item.type === 'lobehub' ? item.provider.id : item.serverType.identifier,
        ),
      ),
    [connectorCatalog],
  );
  // Get all skill identifier sets (used for filtering builtinList)
  const allSkillIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    for (const s of installedBuiltinSkills) ids.add(s.identifier);
    for (const s of marketAgentSkills) ids.add(s.identifier);
    for (const s of userAgentSkills) ids.add(s.identifier);
    return ids;
  }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

  // The metadata inventory includes both tools and skill manifests. Exclude
  // every skill here; connectors still have their own dedicated rows.
  const filteredBuiltinList = useMemo(() => {
    const list = builtinList.filter((item) => !connectorIdentifiers.has(item.identifier));
    return list.filter((item) => !allSkillIdentifiers.has(item.identifier));
  }, [builtinList, connectorIdentifiers, allSkillIdentifiers]);

  // The chat picker lists existing connections, including those that need authorization.
  const composioConnections = useMemo(
    () =>
      connectorCatalog.flatMap((item) => {
        if (item.type !== 'composio') return [];
        const server = allComposioServers.find(
          (server) => server.identifier === item.serverType.identifier,
        );
        return server ? [{ server, type: item.serverType }] : [];
      }),
    [connectorCatalog, allComposioServers],
  );
  const lobehubConnections = useMemo(
    () =>
      connectorCatalog.flatMap((item) => {
        if (item.type !== 'lobehub') return [];
        const server = allLobehubSkillServers.find(
          (server) => server.identifier === item.provider.id,
        );
        // A status probe can cache a provider even when there is no connection.
        if (!server || server.status === LobehubSkillStatus.NOT_CONNECTED) return [];
        return [{ provider: item.provider, server }];
      }),
    [connectorCatalog, allLobehubSkillServers],
  );

  // Remove a Composio connection AND drop its identifier from the agent's
  // plugins. `ComposioServerItem.handleConnect` optimistically adds the new
  // server id to `plugins` before OAuth completes, so deleting the connection
  // alone would leave an orphan id behind — which both keeps the row counted as
  // pinned and makes a later reconnect's toggle flip the freshly-connected skill
  // back off. `togglePlugin(id, false)` is a no-op when the id is absent.
  const removeComposioServer = useCallback(
    async (identifier: string) => {
      await removeComposioConnection(identifier);
      // Best-effort cleanup: dropping the optimistic plugin id must never break
      // the delete itself, so swallow any failure here.
      try {
        await updateSkillPolicy(identifier, 'disabled');
      } catch (error) {
        console.error('[Composio] Failed to unpin plugin after delete:', error);
      }
    },
    [removeComposioConnection, updateSkillPolicy],
  );

  const composioServerItems = useMemo(
    () =>
      isComposioEnabledInEnv
        ? composioConnections.map(({ server, type }) => {
            const icon = (
              <ComposioSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />
            );
            const popoverContent = (
              <ToolItemDetailPopover
                icon={<ComposioSkillIcon icon={type.icon} label={type.label} size={36} />}
                identifier={type.identifier}
                sourceLabel={type.author}
                title={type.label}
                description={t(`tools.composio.servers.${type.identifier}.description` as any, {
                  defaultValue: type.description,
                })}
              />
            );

            if (server.status === ComposioServerStatus.ACTIVE) {
              return createManagedSkillItem({
                badge: <Icon icon={McpIcon} size={12} />,
                deleteConfig: {
                  displayName: type.label,
                  onDelete: () => removeComposioServer(server.identifier),
                },
                extraTag: type.author === 'LobeHub' ? officialTag : undefined,
                icon,
                id: server.identifier,
                popoverContent,
                searchText: `${type.label} ${server.identifier}`,
                title: type.label,
              });
            }

            // Keep the reauthorization action and deletion available on unfinished connections.
            return {
              extra: renderPolicyMenu(server.identifier, {
                deleteConfig: {
                  displayName: type.label,
                  onDelete: () => removeComposioServer(server.identifier),
                },
                deleteOnly: true,
              }),
              key: server.identifier,
              label: (
                <span
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openSkillPolicyMenu(server.identifier);
                  }}
                >
                  <ComposioServerItem
                    agentId={agentId}
                    appSlug={type.appSlug}
                    icon={icon}
                    identifier={type.identifier}
                    label={type.label}
                    server={server}
                  />
                </span>
              ),
              popoverContent,
              searchText: `${type.label} ${server.identifier}`,
            } as SkillMenuItem;
          })
        : [],
    [
      isComposioEnabledInEnv,
      composioConnections,
      agentId,
      t,
      createManagedSkillItem,
      removeComposioServer,
      renderPolicyMenu,
      openSkillPolicyMenu,
    ],
  );

  const lobehubSkillItems = useMemo(
    () =>
      isLobehubSkillEnabled
        ? lobehubConnections.map(({ provider, server }) => {
            const icon = (
              <LobehubSkillIcon
                icon={provider.icon}
                label={provider.label}
                size={SKILL_ICON_SIZE}
              />
            );
            const popoverContent = (
              <ToolItemDetailPopover
                icon={<LobehubSkillIcon icon={provider.icon} label={provider.label} size={36} />}
                identifier={provider.id}
                sourceLabel={provider.author}
                title={provider.label}
                description={t(`tools.lobehubSkill.providers.${provider.id}.description` as any, {
                  defaultValue: provider.description,
                })}
              />
            );

            if (server.status === LobehubSkillStatus.CONNECTED || server.isConnected) {
              return createManagedSkillItem({
                badge: <Icon icon={McpIcon} size={12} />,
                extraTag: provider.author === 'LobeHub' ? officialTag : undefined,
                icon,
                id: server.identifier,
                popoverContent,
                searchText: `${provider.label} ${server.identifier}`,
                title: provider.label,
              });
            }

            return {
              key: provider.id, // Use provider.id as key, consistent with pluginId
              label: (
                <LobehubSkillServerItem
                  agentId={agentId}
                  icon={icon}
                  label={provider.label}
                  provider={provider.id}
                />
              ),
              popoverContent,
              searchText: provider.label,
            };
          })
        : [],
    [isLobehubSkillEnabled, lobehubConnections, agentId, t, createManagedSkillItem],
  );

  // Builtin tool list items (excluding Composio and LobeHub Skill)
  const builtinItems = useMemo(
    () =>
      filteredBuiltinList.map((item) => {
        const title = t(`tools.builtins.${item.identifier}.title` as any, {
          defaultValue: item.meta?.title || item.identifier,
        });
        const icon = item.meta?.avatar ? (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              item.meta?.avatar ? (
                <Avatar
                  avatar={item.meta.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={Wrench} size={12} />,
          extraTag: officialTag,
          icon,
          id: item.identifier,
          popoverContent,
          searchText: `${title} ${item.identifier}`,
          title,
        });
      }),
    [filteredBuiltinList, t, createManagedSkillItem],
  );

  // Search and memory expose their own settings alongside the on/off choice.
  const capabilityItems: SkillMenuItem[] = useMemo(
    () =>
      [
        {
          enabled: isMemoryCapabilityEnabled,
          manifest: MemoryManifest,
          panelExtra: <MemoryEffortControl />,
          supportedModes: CAPABILITY_MODES,
        },
        {
          enabled: isSearchCapabilityEnabled,
          manifest: WebBrowsingManifest,
          panelExtra: <SearchAdvancedControls />,
          supportedModes: searchCapabilityModes,
        },
      ].map(({ enabled, manifest, panelExtra, supportedModes }) => {
        const { identifier } = manifest;
        const avatar = manifest.meta?.avatar;
        const title = t(`tools.builtins.${identifier}.title` as any, { defaultValue: identifier });

        return createManagedSkillItem({
          extraTag: officialTag,
          icon: avatar ? (
            <Avatar avatar={avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ) : (
            <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
          ),
          id: identifier,
          modeOverride: enabled ? 'auto' : 'disabled',
          panelExtra,
          popoverContent: (
            <ToolItemDetailPopover
              identifier={identifier}
              sourceLabel={t('skillStore.tabs.lobehub')}
              title={title}
              description={t(`tools.builtins.${identifier}.description` as any, {
                defaultValue: '',
              })}
              icon={
                avatar ? (
                  <Avatar avatar={avatar} shape={'square'} size={36} />
                ) : (
                  <Icon icon={SkillsIcon} size={36} />
                )
              }
            />
          ),
          searchText: `${title} ${identifier}`,
          supportedModes,
          title,
        });
      }),
    [
      createManagedSkillItem,
      isMemoryCapabilityEnabled,
      isSearchCapabilityEnabled,
      searchCapabilityModes,
      t,
    ],
  );

  // Connector MCP rows (custom and marketplace). Toggling adds the identifier to
  // agents.plugins[], the field the runtime resolves connectors from.
  const customConnectorItems = useMemo(
    () =>
      customConnectors.map((connector) => {
        const title = connector.name || connector.identifier;
        const icon = <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />;
        const popoverContent = (
          <ToolItemDetailPopover
            description={connector.mcpServerUrl ?? ''}
            icon={<Icon icon={McpIcon} size={36} />}
            identifier={connector.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={title}
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={McpIcon} size={12} />,
          configureConfig: getConfigure(connector),
          deleteConfig: {
            displayName: title,
            onDelete: async () => {
              await deleteConnector(connector.id);
              await unpinDeleted(connector);
            },
          },
          extraTag: connector.visibility === 'private' ? <PrivateConnectorTag /> : undefined,
          icon,
          id: connector.identifier,
          popoverContent,
          searchText: `${title} ${connector.identifier}`,
          title,
        });
      }),
    [customConnectors, t, createManagedSkillItem, deleteConnector, getConfigure, unpinDeleted],
  );

  // Distinguish community plugins and custom plugins.
  // Whitelist `type === 'plugin'` (matching /marketplace/skill/installed) so connected
  // integrations (Composio/LobeHub Skill gateway plugins with other sources like
  // 'self'/'builtin') don't leak in here and duplicate the brand-icon items
  // already rendered under the LobeHub group.
  const communityPlugins = list.filter((item) => item.type === 'plugin');
  const customPlugins = list.filter((item) => item.type === 'customPlugin');

  // Function to map plugins to list items
  const mapPluginToItem = (item: (typeof list)[0]) => {
    const isMcp = item?.runtimeType === 'mcp';
    const hasRealAvatar = !!item?.avatar && item.avatar !== 'MCP_AVATAR';
    const isCustom = item.type === 'customPlugin';
    // Community rows installed server-side may carry no `meta.title`; never
    // render an empty label — fall back to the identifier like every other
    // group in this menu does.
    const title = item.title || item.identifier;
    const icon = hasRealAvatar ? (
      <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
    ) : (
      <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
    );
    const popoverContent = (
      <ToolItemDetailPopover
        description={item.description}
        identifier={item.identifier}
        sourceLabel={isCustom ? t('skillStore.tabs.custom') : t('skillStore.tabs.community')}
        title={title}
        icon={
          hasRealAvatar ? (
            <Avatar
              avatar={item.avatar}
              shape={'square'}
              size={36}
              style={{ flex: 'none', marginInlineEnd: 0 }}
            />
          ) : (
            <Icon icon={McpIcon} size={36} />
          )
        }
      />
    );

    return createManagedSkillItem({
      badge: isMcp ? <Icon icon={McpIcon} size={12} /> : undefined,
      configureConfig: isCustom
        ? { onConfigure: () => openPluginEditModal(item.identifier) }
        : undefined,
      deleteConfig: {
        displayName: title,
        onDelete: () => uninstallPluginRow(item),
      },
      extraTag: isCustom ? (
        <Tag color={'warning'} icon={<Icon icon={Package} />} size={'small'}>
          {t('store.customPlugin', { ns: 'plugin' })}
        </Tag>
      ) : item.author === 'LobeHub' ? (
        officialTag
      ) : undefined,
      icon,
      id: item.identifier,
      popoverContent,
      searchText: `${title} ${item.identifier}`,
      title,
    });
  };

  // Only builtin tools and service integrations belong in this activation picker.
  const lobehubGroupChildren: ItemType[] = [
    ...builtinItems,
    ...lobehubSkillItems,
    ...composioServerItems,
  ];

  // User-installed skills are selected in the Skills panel, not enabled here.
  const communityGroupChildren: ItemType[] = communityPlugins.map(mapPluginToItem);

  // Custom MCP plugins and connectors remain configurable from this picker.
  const customGroupChildren: ItemType[] = [
    ...customPlugins.map(mapPluginToItem),
    ...customConnectorItems,
  ];

  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();
  // Keep the richer integration row ahead of any installed plugin with the same identifier.
  const seenSkillKeys = new Set<string>();
  const allSkillItems = [
    ...lobehubGroupChildren,
    ...communityGroupChildren,
    ...customGroupChildren,
  ].filter((item): item is SkillMenuItem => {
    if (!item || (item as { type?: string }).type === 'divider') return false;
    const key = String(item.key);
    if (seenSkillKeys.has(key)) return false;
    seenSkillKeys.add(key);
    return true;
  });
  const filterBySearch = (items: SkillMenuItem[]) => {
    if (!normalizedSearchKeyword) return items;

    return items.filter((item) =>
      String(item.searchText || item.key || '')
        .toLowerCase()
        .includes(normalizedSearchKeyword),
    );
  };
  const capabilityAutoItems = capabilityItems.filter(
    (item) => !disabledCapabilityIds.has(String(item.key)),
  );
  const capabilityDisabledItems = capabilityItems.filter((item) =>
    disabledCapabilityIds.has(String(item.key)),
  );
  const activeSkillItems = allSkillItems.filter((item) => !disabledIdSet.has(String(item.key)));
  const allAutoItems = [...capabilityAutoItems, ...activeSkillItems];
  const allDisabledItems = [
    ...capabilityDisabledItems,
    ...allSkillItems.filter((item) => disabledIdSet.has(String(item.key))),
  ];
  const autoItems = filterBySearch(allAutoItems);
  const disabledItems = filterBySearch(allDisabledItems);

  const groups = [
    {
      children: autoItems,
      key: 'auto',
      label: t('tools.loading.onDemand'),
      type: 'group' as const,
    },
    {
      children: disabledItems,
      key: 'disabled',
      label: t('tools.loading.never'),
      type: 'group' as const,
    },
  ];
  const marketItems: ItemType[] = normalizedSearchKeyword
    ? groups.filter((group) => group.children.length > 0)
    : filter === 'auto'
      ? autoItems
      : disabledItems;

  const marketHeader = (
    <ToolPickerHeader
      empty={!marketItems.length}
      filter={filter}
      query={searchKeyword}
      onFilterChange={setFilter}
      onSearchChange={setSearchKeyword}
    />
  );

  const marketFooter =
    allSkillItems.length > 0 || capabilityItems.length > 0 ? (
      <button
        aria-label={t('tools.picker.management')}
        {...stylex.props(styles.addSkillRow)}
        disabled={!agentId}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!agentId) return;
          closeDropdown?.();
          navigate(buildAgentProfileTabPath(agentId, 'tools'));
        }}
      >
        <Icon icon={Settings} size={SKILL_ICON_SIZE} />
        <span {...stylex.props(styles.addSkillLabel)}>{t('tools.picker.management')}</span>
      </button>
    ) : undefined;

  return {
    autoCount: allAutoItems.length,
    // Stable inventory order: toggling a checkbox must not move its row.
    toolOptions: [...capabilityItems, ...allSkillItems].map((item) => ({
      canDisable: !!item.canDisable,
      enabled: allAutoItems.includes(item),
      group: communityGroupChildren.includes(item)
        ? 'community'
        : customGroupChildren.includes(item)
          ? 'custom'
          : 'lobehub',
      icon: item.optionIcon,
      id: String(item.key),
      connectionAction: item.optionTitle === undefined && 'label' in item ? item.label : undefined,
      detail: item.detailContent ?? item.popoverContent,
      searchText: item.searchText,
      title: item.optionTitle,
    })),
    canEdit,
    setPolicy: updateSkillPolicy,
    totalCount: allAutoItems.length + allDisabledItems.length,
    isPolicyMenuOpen: policyOpenId !== null,
    marketFooter,
    marketHeader,
    marketItems,
  };
};
