'use client';

import { getConnectorCatalog } from '@lobechat/const';
import { getActivePluginIds, parsePluginEntry, upsertPluginMode } from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';
import { Avatar, Button, cssVar, Flexbox, Icon } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import React, { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import ComposioServerItem from '@/features/ChatInput/ActionBar/Tools/ComposioServerItem';
import ComposioSkillIcon, {
  SKILL_ICON_SIZE,
} from '@/features/ChatInput/ActionBar/Tools/ComposioSkillIcon';
import LobehubSkillIcon from '@/features/ChatInput/ActionBar/Tools/LobehubSkillIcon';
import LobehubSkillServerItem from '@/features/ChatInput/ActionBar/Tools/LobehubSkillServerItem';
import MarketAgentSkillPopoverContent from '@/features/ChatInput/ActionBar/Tools/MarketAgentSkillPopoverContent';
import MarketSkillIcon from '@/features/ChatInput/ActionBar/Tools/MarketSkillIcon';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import ToolItemDetailPopover from '@/features/ChatInput/ActionBar/Tools/ToolItemDetailPopover';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  composioStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { agentSkillListResource } from '@/store/tool/slices/agentSkills/projection';
import type { LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { type ItemDetail } from './ItemDetailPanel';
import PluginTag from './PluginTag';
import PopoverContent from './PopoverContent';
import { getVisibleProfileToolIds } from './profileToolVisibility';
import { selectProfileToolCatalogsSynced, useStalePluginAutoResolve } from './staleProfilePlugins';
import ToolListGroup, { type ToolGroupMeta } from './ToolListGroup';

export interface AgentToolProps {
  /**
   * Optional agent ID to use instead of currentAgentConfig
   * Used in group profile to specify which member's plugins to display
   */
  agentId?: string;
  /**
   * Hide identifiers that are agent-owned/linked connectors from the rendered
   * chips. ONLY the two-section agent profile sets this (it renders those
   * connectors in a separate "Agent Tools" section above, so showing them here
   * too would duplicate them — as an "uninstalled" chip lacking a base manifest).
   * Consumers that render `AgentTool` as the SOLE tool list (e.g. the group
   * member profile) MUST leave this off, otherwise the enabled agent tool would
   * disappear entirely with no way to see or remove it.
   * @default false
   */
  excludeAgentConnectors?: boolean;
  /**
   * Whether to filter tools by availableInWeb property
   * @default false
   */
  filterAvailableInWeb?: boolean;
  /** The heading, description and action of the list; only the `list` variant shows them. */
  group?: ToolGroupMeta;
  /**
   * Which part of the library this list covers. Skills are agent skills (built-in, market and
   * your own); tools are everything else — built-in tools, connectors, plugins. `all` keeps the
   * single mixed list.
   * @default 'all'
   */
  kind?: 'all' | 'skills' | 'tools';
  /** Called with an item's details when its row is clicked; the page decides where to show them. */
  onOpenDetail?: (detail: ItemDetail) => void;
  /**
   * Show an "authorized by X" avatar on each connector chip. Set by the
   * two-section agent profile in a workspace so a teammate can see whose
   * credentials each shared tool runs under. Off elsewhere (personal mode has a
   * single authorizer — always the caller — so the tag would be noise).
   * @default false
   */
  showAuthor?: boolean;
  /**
   * Whether to include installed hidden tools that remain profile-configurable
   * @default false
   */
  useAllMetaList?: boolean;
  /**
   * `list` shows one row per tool with the add control below; `chip` keeps the compact
   * wrapping tags.
   * @default 'chip'
   */
  variant?: 'chip' | 'list';
}

const AgentTool = memo<AgentToolProps>(
  ({
    agentId,
    filterAvailableInWeb = false,
    useAllMetaList = false,
    excludeAgentConnectors = false,
    showAuthor = false,
    kind = 'all',
    group,
    onOpenDetail,
    variant = 'chip',
  }) => {
    const { t } = useTranslation('setting');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const effectiveAgentId = agentId || activeAgentId || '';
    const config = useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId), isEqual);
    const isManualSkillMode = config?.chatConfig?.skillActivateMode === 'manual';
    // Workspace General access on this agent. A private agent is creator-only and
    // has no shared access row, so skip the query for it (same shape as the
    // prompt editor's gate). Only the automatic stale-plugin cleanup below reads
    // this — the visible controls keep their own `canEdit` gating.
    const isPrivateAgent = useAgentStore(
      (s) => s.agentMap[effectiveAgentId]?.visibility === 'private',
    );
    const { canEditResource, isAccessResolved } = useResourceAccess(
      'agent',
      isPrivateAgent ? undefined : effectiveAgentId || undefined,
    );

    // Plugin state management — pinned identifiers only (a disabled entry
    // is a distinct, valid config state; this component has no tri-state UI
    // and treats it as "not enabled", matching pre-tri-state semantics).
    const plugins = getActivePluginIds(config?.plugins);

    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

    // Keep the broad list for stale-config validation. The picker uses the
    // narrower profile list below so runtime-owned tools never become choices.
    const knownBuiltinList = useToolStore(
      useAllMetaList ? builtinToolSelectors.installedAllMetaList : builtinToolSelectors.metaList,
      isEqual,
    );
    const profileBuiltinList = useToolStore(
      useAllMetaList
        ? builtinToolSelectors.installedProfileConfigurableMetaList({
            isManualMode: isManualSkillMode,
          })
        : builtinToolSelectors.metaList,
      isEqual,
    );
    const nonProfileConfigurableBuiltinToolIds = useToolStore(
      builtinToolSelectors.nonProfileConfigurableBuiltinToolIds({
        isManualMode: isManualSkillMode,
      }),
      isEqual,
    );
    const nonProfileConfigurableBuiltinToolIdentifiers = useMemo(
      () => new Set(nonProfileConfigurableBuiltinToolIds),
      [nonProfileConfigurableBuiltinToolIds],
    );

    // Composio-related state
    const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
    const isComposioEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableComposio);

    // LobeHub Skill-related state
    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

    // Agent Skills-related state
    const installedBuiltinSkills = useToolStore(
      builtinToolSelectors.installedBuiltinSkills,
      isEqual,
    );
    const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
    const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

    const [updating, setUpdating] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Fetch plugins
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
    useCheckPluginsIsInstalled(plugins);

    // Load user's Composio integrations via SWR (from database)
    useFetchUserComposioConnections(isComposioEnabledInEnv);

    // Load user's LobeHub Skill connections via SWR
    useFetchLobehubSkillConnections(isLobehubSkillEnabled);

    // Custom connectors (user-added OAuth MCP servers) from the connector store
    const customConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);
    // Agent-owned / linked connectors: when `excludeAgentConnectors` is set (the
    // two-section agent profile), these are rendered in the dedicated "Agent
    // Tools" section above, so they must be dropped from THIS base/user list —
    // otherwise the identifier, pinned into `config.plugins` for runtime gating,
    // would surface here too and, lacking a base-dimension manifest, render as an
    // "uninstalled" chip. When the prop is off (e.g. the group member profile,
    // where AgentTool is the only tool list) they are kept, so the enabled tool
    // stays visible and removable. Display-only either way; the pin is untouched.
    const agentConnectors = useToolStore(
      connectorSelectors.agentConnectors(effectiveAgentId),
      isEqual,
    );
    const agentConnectorIdentifiers = useMemo(
      () => (excludeAgentConnectors ? new Set(agentConnectors.map((c) => c.identifier)) : null),
      [agentConnectors, excludeAgentConnectors],
    );
    const isConnectorsInit = useToolStore((s) => s.isConnectorsInit);
    const isToolStoreCatalogSynced = useToolStore(selectProfileToolCatalogsSynced);
    // Not `serverConfigInit`: it is also set by the error fallback, whose default
    // config hides the Composio and LobeHub Skill catalogs.
    const isServerConfigLoaded = useServerConfigStore((s) => s.serverConfigLoaded);
    const isToolCatalogSynced = isToolStoreCatalogSynced && isServerConfigLoaded;
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    useEffect(() => {
      if (!isConnectorsInit) fetchConnectors();
    }, [isConnectorsInit, fetchConnectors]);

    // Toggle a plugin - use byId action
    const togglePlugin = useCallback(
      async (pluginId: string, state?: boolean) => {
        if (!canEdit) return;
        if (!effectiveAgentId) return;
        const hasPlugin = plugins.includes(pluginId);
        const shouldEnable = state !== undefined ? state : !hasPlugin;
        // Taking an item out must also work on one that is switched off: it is not pinned, but
        // it still has an entry to remove.
        const hasEntry = (config?.plugins ?? []).some(
          (entry) => parsePluginEntry(entry).identifier === pluginId,
        );
        if (shouldEnable ? hasPlugin : !hasEntry) return;

        // upsertPluginMode operates on the raw (possibly mixed-shape) config
        // — not the pinned-only `plugins` above — so an existing disabled
        // entry is flipped in place instead of being dropped from the array.
        await updateAgentConfigById(effectiveAgentId, {
          plugins: upsertPluginMode(config?.plugins, pluginId, shouldEnable ? 'pinned' : 'auto'),
        });
      },
      [canEdit, effectiveAgentId, plugins, config?.plugins, updateAgentConfigById],
    );

    // Check if a profile-managed tool is pinned.
    const isToolEnabled = useCallback(
      (identifier: string) => plugins.includes(identifier),
      [plugins],
    );

    // Toggle a profile-managed tool.
    const handleToggleTool = useCallback(
      async (identifier: string) => {
        await togglePlugin(identifier);
      },
      [togglePlugin],
    );

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
    const composioConnectorTypes = useMemo(
      () =>
        connectorCatalog
          .filter((item) => item.type === 'composio')
          .map(({ serverType }) => serverType),
      [connectorCatalog],
    );
    const lobehubConnectorProviders = useMemo(
      () =>
        connectorCatalog.filter((item) => item.type === 'lobehub').map(({ provider }) => provider),
      [connectorCatalog],
    );

    // Get all skill identifiers (used to filter the builtin list)
    const allSkillIdentifiers = useMemo(() => {
      const ids = new Set<string>();
      for (const s of installedBuiltinSkills) ids.add(s.identifier);
      for (const s of marketAgentSkills) ids.add(s.identifier);
      for (const s of userAgentSkills) ids.add(s.identifier);
      return ids;
    }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

    // Filter out Composio tools and skills from profileBuiltinList (they are displayed separately)
    // Optionally filter out tools with availableInWeb: false based on config (e.g., LocalSystem is desktop-only)
    const filteredBuiltinList = useMemo(() => {
      // Cast to LobeToolMetaWithAvailability for type safety when filterAvailableInWeb is used
      type ListType = typeof profileBuiltinList;
      let list: ListType = profileBuiltinList;

      // Filter by availableInWeb if requested (only makes sense when using allMetaList)
      if (filterAvailableInWeb && useAllMetaList) {
        list = (list as LobeToolMetaWithAvailability[]).filter(
          (item) => item.availableInWeb,
        ) as ListType;
      }

      // Connector identifiers are rendered through their canonical owner below.
      list = list.filter((item) => !connectorIdentifiers.has(item.identifier));

      // Filter out skills (they are shown separately)
      list = list.filter((item) => !allSkillIdentifiers.has(item.identifier));

      return list;
    }, [
      profileBuiltinList,
      connectorIdentifiers,
      filterAvailableInWeb,
      useAllMetaList,
      allSkillIdentifiers,
    ]);

    // Composio server list items
    const composioServerItems = useMemo(
      () =>
        isComposioEnabledInEnv
          ? composioConnectorTypes.map((type) => ({
              icon: (
                <ComposioSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />
              ),
              key: type.identifier,
              label: (
                <ComposioServerItem
                  agentId={effectiveAgentId}
                  appSlug={type.appSlug}
                  identifier={type.identifier}
                  label={type.label}
                  server={allComposioServers.find(
                    (server) => server.identifier === type.identifier,
                  )}
                />
              ),
              popoverContent: (
                <ToolItemDetailPopover
                  icon={<ComposioSkillIcon icon={type.icon} label={type.label} size={36} />}
                  identifier={type.identifier}
                  sourceLabel={type.author}
                  title={type.label}
                  description={t(`tools.composio.servers.${type.identifier}.description` as any, {
                    defaultValue: type.description,
                  })}
                />
              ),
            }))
          : [],
      [isComposioEnabledInEnv, composioConnectorTypes, allComposioServers, effectiveAgentId, t],
    );

    // LobeHub Skill Provider list items
    const lobehubSkillItems = useMemo(
      () =>
        isLobehubSkillEnabled
          ? lobehubConnectorProviders.map((provider) => ({
              icon: (
                <LobehubSkillIcon
                  icon={provider.icon}
                  label={provider.label}
                  size={SKILL_ICON_SIZE}
                />
              ),
              key: provider.id, // Use provider.id as key, consistent with pluginId
              label: (
                <LobehubSkillServerItem
                  agentId={effectiveAgentId}
                  label={provider.label}
                  provider={provider.id}
                />
              ),
              popoverContent: (
                <ToolItemDetailPopover
                  icon={<LobehubSkillIcon icon={provider.icon} label={provider.label} size={36} />}
                  identifier={provider.id}
                  sourceLabel={provider.author}
                  title={provider.label}
                  description={t(`tools.lobehubSkill.providers.${provider.id}.description` as any, {
                    defaultValue: provider.description,
                  })}
                />
              ),
            }))
          : [],
      [isLobehubSkillEnabled, lobehubConnectorProviders, effectiveAgentId, t],
    );

    // Handle plugin remove via Tag close - use byId actions
    const handleRemovePlugin =
      (
        pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> },
      ) =>
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!canEdit) return;

        const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;
        await togglePlugin(identifier, false);
      };

    // Builtin Agent Skills list items (grouped under LobeHub)
    const builtinAgentSkillItems = useMemo(
      () =>
        installedBuiltinSkills.map((skill) => ({
          icon: skill.avatar ? (
            <Avatar avatar={skill.avatar} size={SKILL_ICON_SIZE} style={{ marginInlineEnd: 0 }} />
          ) : (
            <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
          ),
          key: skill.identifier,
          label: (
            <ToolItem
              checked={isToolEnabled(skill.identifier)}
              id={skill.identifier}
              label={skill.name}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(skill.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              identifier={skill.identifier}
              sourceLabel={t('skillStore.tabs.lobehub')}
              description={t(`tools.builtins.${skill.identifier}.description` as any, {
                defaultValue: skill.description,
              })}
              icon={
                skill.avatar ? (
                  <Avatar
                    avatar={skill.avatar}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                ) : (
                  <Icon icon={SkillsIcon} size={36} />
                )
              }
              title={t(`tools.builtins.${skill.identifier}.title` as any, {
                defaultValue: skill.name,
              })}
            />
          ),
        })),
      [installedBuiltinSkills, isToolEnabled, handleToggleTool, t],
    );

    // Market Agent Skills list items (grouped under Community)
    const marketAgentSkillItems = useMemo(
      () =>
        marketAgentSkills.map((skill) => ({
          icon: (
            <MarketSkillIcon
              identifier={skill.identifier}
              name={skill.name}
              size={SKILL_ICON_SIZE}
            />
          ),
          key: skill.identifier,
          label: (
            <ToolItem
              checked={isToolEnabled(skill.identifier)}
              id={skill.identifier}
              label={skill.name}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(skill.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <MarketAgentSkillPopoverContent
              description={skill.description}
              identifier={skill.identifier}
              name={skill.name}
              sourceLabel={t('skillStore.tabs.community')}
            />
          ),
        })),
      [marketAgentSkills, isToolEnabled, handleToggleTool, t],
    );

    // User Agent Skills list items (grouped under Custom)
    const userAgentSkillItems = useMemo(
      () =>
        userAgentSkills.map((skill) => ({
          icon: <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />,
          key: skill.identifier,
          label: (
            <ToolItem
              checked={isToolEnabled(skill.identifier)}
              id={skill.identifier}
              label={skill.name}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(skill.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={skill.description}
              icon={<Icon icon={SkillsIcon} size={36} />}
              identifier={skill.identifier}
              sourceLabel={t('skillStore.tabs.custom')}
              title={skill.name}
            />
          ),
        })),
      [userAgentSkills, isToolEnabled, handleToggleTool, t],
    );

    // Merge Builtin Agent Skills, builtin tools, LobeHub Skill Providers, and Composio servers
    const builtinItems = useMemo(
      () => [
        // 1. Builtin Agent Skills
        ...builtinAgentSkillItems,
        // 2. Original builtin tools
        ...filteredBuiltinList.map((item) => ({
          icon: (
            <Avatar
              avatar={item.meta.avatar}
              size={SKILL_ICON_SIZE}
              style={{ marginInlineEnd: 0 }}
            />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={isToolEnabled(item.identifier)}
              id={item.identifier}
              label={item.meta?.title}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(item.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              identifier={item.identifier}
              sourceLabel={t('skillStore.tabs.lobehub')}
              description={t(`tools.builtins.${item.identifier}.description` as any, {
                defaultValue: item.meta?.description || '',
              })}
              icon={
                <Avatar
                  avatar={item.meta.avatar}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              }
              title={t(`tools.builtins.${item.identifier}.title` as any, {
                defaultValue: item.meta?.title || item.identifier,
              })}
            />
          ),
        })),
        // 3. LobeHub Skill Providers
        ...lobehubSkillItems,
        // 4. Composio servers
        ...composioServerItems,
      ],
      [
        builtinAgentSkillItems,
        filteredBuiltinList,
        composioServerItems,
        lobehubSkillItems,
        isToolEnabled,
        handleToggleTool,
        t,
      ],
    );

    // Distinguish community plugins from custom plugins
    const profilePluginList = installedPluginList.filter(
      (item) => !nonProfileConfigurableBuiltinToolIdentifiers.has(item.identifier),
    );
    const communityPlugins = profilePluginList.filter((item) => item.type !== 'customPlugin');
    const customPlugins = profilePluginList.filter((item) => item.type === 'customPlugin');

    // Function to generate plugin list items
    const mapPluginToItem = useCallback(
      (item: (typeof installedPluginList)[0]) => {
        const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
        const isCustom = item.type === 'customPlugin';
        return {
          icon: isMcp ? (
            <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
          ) : (
            <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={plugins.includes(item.identifier)}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                setUpdating(true);
                await togglePlugin(item.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={item.description}
              identifier={item.identifier}
              sourceLabel={isCustom ? t('skillStore.tabs.custom') : t('skillStore.tabs.community')}
              title={item.title}
              icon={
                isMcp ? (
                  <Icon icon={McpIcon} size={36} />
                ) : (
                  <Avatar
                    avatar={item.avatar}
                    shape={'square'}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                )
              }
            />
          ),
        };
      },
      [plugins, togglePlugin, t],
    );

    // Community plugin list items
    const communityPluginItems = useMemo(
      () => communityPlugins.map(mapPluginToItem),
      [communityPlugins, mapPluginToItem],
    );

    // Custom plugin list items
    const customPluginItems = useMemo(
      () => customPlugins.map(mapPluginToItem),
      [customPlugins, mapPluginToItem],
    );

    // Community group children (Market Agent Skills + community plugins)
    const communityGroupChildren = useMemo(
      () => [...marketAgentSkillItems, ...communityPluginItems],
      [marketAgentSkillItems, communityPluginItems],
    );

    // Custom connector list items (user-added OAuth MCP servers)
    const customConnectorItems = useMemo(
      () =>
        customConnectors.map((connector) => {
          return {
            icon: <Icon icon={McpIcon} size={SKILL_ICON_SIZE} style={{ marginInlineEnd: 0 }} />,
            key: connector.identifier,
            label: (
              <ToolItem
                checked={plugins.includes(connector.identifier)}
                id={connector.identifier}
                label={connector.name || connector.identifier}
                onUpdate={async () => {
                  setUpdating(true);
                  await togglePlugin(connector.identifier);
                  setUpdating(false);
                }}
              />
            ),
            popoverContent: (
              <ToolItemDetailPopover
                description={connector.mcpServerUrl ?? ''}
                icon={<Icon icon={McpIcon} size={36} />}
                identifier={connector.identifier}
                sourceLabel={t('skillStore.tabs.custom')}
                title={connector.name || connector.identifier}
              />
            ),
          };
        }),
      [customConnectors, plugins, togglePlugin, t],
    );

    // Custom group children (User Agent Skills + custom plugins + custom connectors)
    const customGroupChildren = useMemo(
      () => [...userAgentSkillItems, ...customPluginItems, ...customConnectorItems],
      [userAgentSkillItems, customPluginItems, customConnectorItems],
    );

    // All tab items (marketplace tab)
    const allTabItems: ItemType[] = useMemo(
      () => [
        // LobeHub group
        ...(builtinItems.length > 0
          ? [
              {
                children: builtinItems,
                key: 'lobehub',
                label: t('skillStore.tabs.lobehub'),
                type: 'group' as const,
              },
            ]
          : []),
        // Community group (Market Agent Skills + community plugins)
        ...(communityGroupChildren.length > 0
          ? [
              {
                children: communityGroupChildren,
                key: 'community',
                label: t('skillStore.tabs.community'),
                type: 'group' as const,
              },
            ]
          : []),
        // Custom group (User Agent Skills + custom plugins)
        ...(customGroupChildren.length > 0
          ? [
              {
                children: customGroupChildren,
                key: 'custom',
                label: t('skillStore.tabs.custom'),
                type: 'group' as const,
              },
            ]
          : []),
      ],
      [builtinItems, communityGroupChildren, customGroupChildren, t],
    );

    const button = (
      <Button
        disabled={!canEdit}
        icon={PlusIcon}
        loading={updating}
        size={'small'}
        style={variant === 'list' ? undefined : { color: cssVar.colorTextSecondary }}
        type={'text'}
      >
        {kind === 'tools'
          ? t('settingAgent.agentTools.add')
          : t('tools.add', { defaultValue: 'Add' })}
      </Button>
    );

    // ──────────────────────────────────────────────
    // Auto-cleanup stale plugins that no longer exist
    // ──────────────────────────────────────────────
    // Build the set of all valid identifiers known to the system
    const validIdentifiers = useMemo(() => {
      const all = new Set<string>();

      // 1. Builtin tools (includes Composio metas)
      for (const tool of knownBuiltinList) all.add(tool.identifier);

      // 2. Installed plugins
      for (const plugin of installedPluginList) all.add(plugin.identifier);

      // 3. Canonical connector identifiers
      for (const connector of connectorCatalog) {
        all.add(
          connector.type === 'lobehub' ? connector.provider.id : connector.serverType.identifier,
        );
      }

      // 5. Builtin skills
      for (const skill of installedBuiltinSkills) all.add(skill.identifier);

      // 6. Market agent skills
      for (const skill of marketAgentSkills) all.add(skill.identifier);

      // 7. User agent skills
      for (const skill of userAgentSkills) all.add(skill.identifier);

      // 8. Custom connectors
      for (const connector of customConnectors) all.add(connector.identifier);

      return all;
    }, [
      knownBuiltinList,
      installedPluginList,
      connectorCatalog,
      installedBuiltinSkills,
      marketAgentSkills,
      userAgentSkills,
      customConnectors,
    ]);

    // Self-heal unresolved plugin entries once the catalogs are complete. They
    // may be Market skills that are not installed yet, so the server is asked
    // first and only entries it says are not skills are removed.
    useStalePluginAutoResolve({
      agentId: effectiveAgentId,
      canEditContent: canEdit,
      canEditResource,
      getScope: () => agentSkillListResource.scope.get(),
      getCurrentPlugins: () =>
        agentSelectors.getAgentConfigById(effectiveAgentId)(useAgentStore.getState())?.plugins,
      isAccessResolved,
      isConnectorsInit,
      isToolCatalogSynced,
      plugins: config?.plugins,
      scope: agentSkillListResource.scope.use(),
      // Best-effort: the user never asked for this, so a rejection (edit lock
      // held by another member, access revoked between render and write) must
      // not claim "your change was not applied". It retries on the next open.
      updatePlugins: (id, nextPlugins) =>
        updateAgentConfigById(id, { plugins: nextPlugins }, { showErrorMessage: false }),
      validIdentifiers,
    });

    // Only display tools that this profile surface actually manages. Runtime-
    // managed entries remain untouched in config for compatibility with other
    // flows, but do not inflate this section's count or render misleading chips.
    const allEnabledTools = useMemo(() => {
      const visible = getVisibleProfileToolIds(plugins, {
        agentConnectorIdentifiers,
        nonConfigurableBuiltinToolIdentifiers: nonProfileConfigurableBuiltinToolIdentifiers,
      });
      if (kind === 'all') return visible;
      return visible.filter((id) => allSkillIdentifiers.has(id) === (kind === 'skills'));
    }, [
      plugins,
      agentConnectorIdentifiers,
      nonProfileConfigurableBuiltinToolIdentifiers,
      kind,
      allSkillIdentifiers,
    ]);

    // A list shows what is turned off as well, so it can be turned back on; the chips show only
    // what is on.
    const listedTools = useMemo(() => {
      const entries = (config?.plugins ?? [])
        .map((entry) => parsePluginEntry(entry))
        .filter((entry) => entry.mode !== 'auto');
      const visible = getVisibleProfileToolIds(
        entries.map((entry) => entry.identifier),
        {
          agentConnectorIdentifiers,
          nonConfigurableBuiltinToolIdentifiers: nonProfileConfigurableBuiltinToolIdentifiers,
        },
      );
      return kind === 'all'
        ? visible
        : visible.filter((id) => allSkillIdentifiers.has(id) === (kind === 'skills'));
    }, [
      config?.plugins,
      agentConnectorIdentifiers,
      nonProfileConfigurableBuiltinToolIdentifiers,
      kind,
      allSkillIdentifiers,
    ]);
    const disabledToolIds = useMemo(
      () =>
        new Set(
          (config?.plugins ?? [])
            .map((entry) => parsePluginEntry(entry))
            .filter((entry) => entry.mode === 'disabled')
            .map((entry) => entry.identifier),
        ),
      [config?.plugins],
    );
    const setPluginEnabled = (pluginId: string, enabled: boolean) => {
      if (!canEdit || !effectiveAgentId) return;
      return updateAgentConfigById(effectiveAgentId, {
        plugins: upsertPluginMode(config?.plugins, pluginId, enabled ? 'pinned' : 'disabled'),
      });
    };

    // Where a skill comes from, for the label on its row.
    const skillSource = useMemo(() => {
      const map = new Map<string, string>();
      for (const skill of installedBuiltinSkills)
        map.set(skill.identifier, t('settingAgent.skills.source.builtin'));
      for (const skill of marketAgentSkills)
        map.set(skill.identifier, t('settingAgent.skills.source.community'));
      for (const skill of userAgentSkills)
        map.set(skill.identifier, t('settingAgent.skills.source.custom'));
      return map;
    }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills, t]);

    // The picker lists only what this page is about, so the Skills page never offers a tool.
    const pickerItems = useMemo(() => {
      if (kind === 'all') return allTabItems;
      return allTabItems.flatMap((item) => {
        if (!item || !('children' in item) || !item.children) return [item];
        const children = item.children.filter(
          (child) =>
            !!child &&
            'key' in child &&
            allSkillIdentifiers.has(String(child.key)) === (kind === 'skills'),
        );
        return children.length > 0 ? [{ ...item, children }] : [];
      });
    }, [allTabItems, allSkillIdentifiers, kind]);

    const addControl = (
      <Suspense fallback={button}>
        {/* Plugin Selector Dropdown - Using Action component pattern */}
        <ActionDropdown
          maxWidth={400}
          minWidth={400}
          open={dropdownOpen}
          placement={'bottomLeft'}
          trigger={'click'}
          menu={{
            items: [],
            style: {
              // let only the custom scroller scroll
              maxHeight: 'unset',
              overflowY: 'visible',
            },
          }}
          popupProps={{
            style: {
              padding: 0,
            },
          }}
          popupRender={() => (
            <PopoverContent
              items={pickerItems}
              onClose={() => setDropdownOpen(false)}
              onOpenStore={() => {
                setDropdownOpen(false);
                createSkillStoreModal();
              }}
            />
          )}
          positionerProps={{
            collisionAvoidance: { align: 'flip', fallbackAxisSide: 'end', side: 'flip' },
            collisionBoundary:
              typeof document === 'undefined' ? undefined : document.documentElement,
            positionMethod: 'fixed',
          }}
          onOpenChange={(next) => {
            if (!canEdit) return;

            setDropdownOpen(next);
          }}
        >
          {button}
        </ActionDropdown>
      </Suspense>
    );

    if (variant === 'list' && group) {
      return (
        <ToolListGroup
          {...group}
          activeCount={listedTools.filter((id) => !disabledToolIds.has(id)).length}
          addControl={addControl}
          emptyText={t(
            kind === 'skills'
              ? 'settingAgent.tools.level.skillsEmpty'
              : 'settingAgent.tools.level.libraryEmpty',
          )}
          rows={listedTools.map((pluginId) => (
            <PluginTag
              disabled={!canEdit}
              enabled={!disabledToolIds.has(pluginId)}
              isSkill={kind === 'skills'}
              key={pluginId}
              pluginId={pluginId}
              showAuthor={showAuthor}
              showDesktopOnlyLabel={filterAvailableInWeb}
              tagLabel={kind === 'skills' ? skillSource.get(pluginId) : undefined}
              useAllMetaList={useAllMetaList}
              variant={'row'}
              onOpen={onOpenDetail}
              onRemove={handleRemovePlugin(pluginId)}
              onToggle={(next) => void setPluginEnabled(pluginId, next)}
            />
          ))}
          total={pickerItems.reduce(
            (sum, item) =>
              sum + (item && 'children' in item && item.children ? item.children.length : 0),
            0,
          )}
        />
      );
    }

    return (
      <>
        {/* Plugin Selector and Tags */}
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          {addControl}
          {/* Selected Plugins as Tags */}
          {allEnabledTools.map((pluginId) => (
            <PluginTag
              disabled={!canEdit}
              key={pluginId}
              pluginId={pluginId}
              showAuthor={showAuthor}
              showDesktopOnlyLabel={filterAvailableInWeb}
              useAllMetaList={useAllMetaList}
              onRemove={handleRemovePlugin(pluginId)}
            />
          ))}
        </Flexbox>
      </>
    );
  },
);

AgentTool.displayName = 'AgentTool';

export default AgentTool;
