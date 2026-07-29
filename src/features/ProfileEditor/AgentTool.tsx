'use client';

import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { getActivePluginIds, parsePluginEntry, upsertPluginMode } from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';
import { Avatar, Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import React, { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import PluginTag from './PluginTag';
import PopoverContent from './PopoverContent';
import { getVisibleProfileToolIds } from './profileToolVisibility';

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
}

const AgentTool = memo<AgentToolProps>(
  ({
    agentId,
    filterAvailableInWeb = false,
    useAllMetaList = false,
    excludeAgentConnectors = false,
    showAuthor = false,
  }) => {
    const { t } = useTranslation('setting');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const effectiveAgentId = agentId || activeAgentId || '';
    const config = useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId), isEqual);
    const isManualSkillMode = config?.chatConfig?.skillActivateMode === 'manual';

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
        if (shouldEnable === hasPlugin) return;

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

    // Get all Composio server type identifiers (used to filter the builtin list)
    const allComposioTypeIdentifiers = useMemo(
      () => new Set(COMPOSIO_APP_TYPES.map((type) => type.identifier)),
      [],
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

      // Filter out Composio tools if Composio is enabled
      if (isComposioEnabledInEnv) {
        list = list.filter((item) => !allComposioTypeIdentifiers.has(item.identifier));
      }

      // Filter out skills (they are shown separately)
      list = list.filter((item) => !allSkillIdentifiers.has(item.identifier));

      return list;
    }, [
      profileBuiltinList,
      allComposioTypeIdentifiers,
      isComposioEnabledInEnv,
      filterAvailableInWeb,
      useAllMetaList,
      allSkillIdentifiers,
    ]);

    // Composio server list items
    const composioServerItems = useMemo(
      () =>
        isComposioEnabledInEnv
          ? COMPOSIO_APP_TYPES.map((type) => ({
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
      [isComposioEnabledInEnv, allComposioServers, effectiveAgentId, t],
    );

    // LobeHub Skill Provider list items
    const lobehubSkillItems = useMemo(
      () =>
        isLobehubSkillEnabled
          ? LOBEHUB_SKILL_PROVIDERS.map((provider) => ({
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
      [isLobehubSkillEnabled, effectiveAgentId, t],
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
        style={{ color: cssVar.colorTextSecondary }}
        type={'text'}
      >
        {t('tools.add', { defaultValue: 'Add' })}
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

      // 3. Composio server types (if enabled)
      if (isComposioEnabledInEnv) {
        for (const type of COMPOSIO_APP_TYPES) all.add(type.identifier);
      }

      // 4. LobeHub Skill providers (if enabled)
      if (isLobehubSkillEnabled) {
        for (const provider of LOBEHUB_SKILL_PROVIDERS) all.add(provider.id);
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
      isComposioEnabledInEnv,
      isLobehubSkillEnabled,
      installedBuiltinSkills,
      marketAgentSkills,
      userAgentSkills,
      customConnectors,
    ]);

    // Track whether initial cleanup has been performed
    const cleanupDoneRef = useRef(false);

    // Auto-remove stale plugin IDs from the agent config
    // Uses a short debounce to allow async data (SWR) to complete loading
    useEffect(() => {
      if (cleanupDoneRef.current) return;
      if (validIdentifiers.size === 0) return;
      const rawPlugins = config?.plugins ?? [];
      if (rawPlugins.length === 0) return;
      // Don't prune until the connector store has loaded — connector identifiers
      // are absent from validIdentifiers until fetchConnectors() resolves, so
      // running cleanup before that would incorrectly mark enabled connectors as stale.
      if (!isConnectorsInit) return;

      // Defer cleanup to avoid race with async data loading (SWR, Composio, etc.)
      const timer = setTimeout(() => {
        // Checked (and filtered) by identifier regardless of entry shape, so
        // a stale disabled/pinned object entry is pruned exactly like a
        // stale legacy string one — untouched valid entries keep their
        // original shape (lazy per-item upgrade).
        const isValid = (entry: (typeof rawPlugins)[number]) =>
          validIdentifiers.has(parsePluginEntry(entry).identifier);
        const hasStale = rawPlugins.some((entry) => !isValid(entry));

        if (hasStale && effectiveAgentId) {
          const cleanedPlugins = rawPlugins.filter(isValid);
          updateAgentConfigById(effectiveAgentId, { plugins: cleanedPlugins });
        }

        cleanupDoneRef.current = true;
      }, 500);

      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validIdentifiers]);

    // Only display tools that this profile surface actually manages. Runtime-
    // managed entries remain untouched in config for compatibility with other
    // flows, but do not inflate this section's count or render misleading chips.
    const allEnabledTools = useMemo(() => {
      return getVisibleProfileToolIds(plugins, {
        agentConnectorIdentifiers,
        nonConfigurableBuiltinToolIdentifiers: nonProfileConfigurableBuiltinToolIdentifiers,
      });
    }, [plugins, agentConnectorIdentifiers, nonProfileConfigurableBuiltinToolIdentifiers]);

    return (
      <>
        {/* Plugin Selector and Tags */}
        <Flexbox horizontal align="center" gap={8} wrap={'wrap'}>
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
                  items={allTabItems}
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
          {/* Selected Plugins as Tags */}
          {allEnabledTools.map((pluginId) => {
            return (
              <PluginTag
                disabled={!canEdit}
                key={pluginId}
                pluginId={pluginId}
                showAuthor={showAuthor}
                showDesktopOnlyLabel={filterAvailableInWeb}
                useAllMetaList={useAllMetaList}
                onRemove={handleRemovePlugin(pluginId)}
              />
            );
          })}
        </Flexbox>
      </>
    );
  },
);

AgentTool.displayName = 'AgentTool';

export default AgentTool;
