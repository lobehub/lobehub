'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type ItemType } from '@lobehub/ui';
import { Avatar, Button, Flexbox, Icon } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import React, { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import KlavisServerItem from '@/features/ChatInput/ActionBar/Tools/KlavisServerItem';
import KlavisSkillIcon, {
  SKILL_ICON_SIZE,
} from '@/features/ChatInput/ActionBar/Tools/KlavisSkillIcon';
import LobehubSkillIcon from '@/features/ChatInput/ActionBar/Tools/LobehubSkillIcon';
import LobehubSkillServerItem from '@/features/ChatInput/ActionBar/Tools/LobehubSkillServerItem';
import MarketAgentSkillPopoverContent from '@/features/ChatInput/ActionBar/Tools/MarketAgentSkillPopoverContent';
import MarketSkillIcon from '@/features/ChatInput/ActionBar/Tools/MarketSkillIcon';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import ToolItemDetailPopover from '@/features/ChatInput/ActionBar/Tools/ToolItemDetailPopover';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';

import PluginTag from './PluginTag';
import PopoverContent from './PopoverContent';

const WEB_BROWSING_IDENTIFIER = 'lobe-web-browsing';

type TabType = 'all' | 'installed';

export interface AgentToolProps {
  /**
   * Optional agent ID to use instead of currentAgentConfig
   * Used in group profile to specify which member's plugins to display
   */
  agentId?: string;
  /**
   * Whether to filter tools by availableInWeb property
   * @default false
   */
  filterAvailableInWeb?: boolean;
  /**
   * Whether to show web browsing toggle functionality
   * @default false
   */
  showWebBrowsing?: boolean;
  /**
   * Whether to use allMetaList (includes hidden tools) or metaList
   * @default false
   */
  useAllMetaList?: boolean;
}

const AgentTool = memo<AgentToolProps>(
  ({ agentId, showWebBrowsing = false, filterAvailableInWeb = false, useAllMetaList = false }) => {
    const { t } = useTranslation('setting');
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const effectiveAgentId = agentId || activeAgentId || '';
    const config = useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId), isEqual);

    // Plugin state management
    const plugins = config?.plugins || [];

    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const updateAgentChatConfigById = useAgentStore((s) => s.updateAgentChatConfigById);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

    // Use appropriate builtin list based on prop
    // When useAllMetaList is true, use installedAllMetaList to include hidden/platform-specific
    // tools but still exclude user-uninstalled tools
    const builtinList = useToolStore(
      useAllMetaList ? builtinToolSelectors.installedAllMetaList : builtinToolSelectors.metaList,
      isEqual,
    );

    // Web browsing uses searchMode instead of plugins array - use byId selector
    const isSearchEnabled = useAgentStore(
      chatConfigByIdSelectors.isEnableSearchById(effectiveAgentId),
    );

    // Klavis-related state
    const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
    const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

    // LobeHub Skill-related state
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
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

    // Tab state for dual-column layout
    const [activeTab, setActiveTab] = useState<TabType | null>(null);
    const isInitializedRef = useRef(false);

    // Fetch plugins
    const [
      useFetchUserKlavisServers,
      useFetchLobehubSkillConnections,
      useFetchUninstalledBuiltinTools,
      useFetchAgentSkills,
    ] = useToolStore((s) => [
      s.useFetchUserKlavisServers,
      s.useFetchLobehubSkillConnections,
      s.useFetchUninstalledBuiltinTools,
      s.useFetchAgentSkills,
    ]);
    useFetchInstalledPlugins();
    useFetchUninstalledBuiltinTools(true);
    useFetchAgentSkills(true);
    useCheckPluginsIsInstalled(plugins);

    // Load user's Klavis integrations via SWR (from database)
    useFetchUserKlavisServers(isKlavisEnabledInEnv);

    // Load user's LobeHub Skill connections via SWR
    useFetchLobehubSkillConnections(isLobehubSkillEnabled);

    // Toggle web browsing via searchMode - use byId action
    const toggleWebBrowsing = useCallback(async () => {
      if (!effectiveAgentId) return;
      const nextMode = isSearchEnabled ? 'off' : 'auto';
      await updateAgentChatConfigById(effectiveAgentId, { searchMode: nextMode });
    }, [isSearchEnabled, updateAgentChatConfigById, effectiveAgentId]);

    // Toggle a plugin - use byId action
    const togglePlugin = useCallback(
      async (pluginId: string, state?: boolean) => {
        if (!effectiveAgentId) return;
        const currentPlugins = plugins;
        const hasPlugin = currentPlugins.includes(pluginId);
        const shouldEnable = state !== undefined ? state : !hasPlugin;

        let newPlugins: string[];
        if (shouldEnable && !hasPlugin) {
          newPlugins = [...currentPlugins, pluginId];
        } else if (!shouldEnable && hasPlugin) {
          newPlugins = currentPlugins.filter((id) => id !== pluginId);
        } else {
          return;
        }

        await updateAgentConfigById(effectiveAgentId, { plugins: newPlugins });
      },
      [effectiveAgentId, plugins, updateAgentConfigById],
    );

    // Check if a tool is enabled (handles web browsing specially)
    const isToolEnabled = useCallback(
      (identifier: string) => {
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          return isSearchEnabled;
        }
        return plugins.includes(identifier);
      },
      [plugins, isSearchEnabled, showWebBrowsing],
    );

    // Toggle a tool (handles web browsing specially)
    const handleToggleTool = useCallback(
      async (identifier: string) => {
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          await toggleWebBrowsing();
        } else {
          await togglePlugin(identifier);
        }
      },
      [toggleWebBrowsing, togglePlugin, showWebBrowsing],
    );

    // Set default tab based on installed plugins (only on first load)
    // Only show 'installed' tab by default if more than 5 plugins are enabled
    useEffect(() => {
      if (!isInitializedRef.current && plugins.length >= 0) {
        isInitializedRef.current = true;
        setActiveTab(plugins.length > 5 ? 'installed' : 'all');
      }
    }, [plugins.length]);

    // Get connected server by identifier
    const getServerByName = (identifier: string) => {
      return allKlavisServers.find((server) => server.identifier === identifier);
    };

    // Get all Klavis server type identifiers (used to filter builtinList)
    const allKlavisTypeIdentifiers = useMemo(
      () => new Set(KLAVIS_SERVER_TYPES.map((type) => type.identifier)),
      [],
    );

    // Get all skill identifiers (used to filter builtinList)
    const allSkillIdentifiers = useMemo(() => {
      const ids = new Set<string>();
      for (const s of installedBuiltinSkills) ids.add(s.identifier);
      for (const s of marketAgentSkills) ids.add(s.identifier);
      for (const s of userAgentSkills) ids.add(s.identifier);
      return ids;
    }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

    // Filter out Klavis tools and skills from builtinList (they are displayed separately)
    // Optionally filter out tools with availableInWeb: false based on config (e.g., LocalSystem is desktop-only)
    const filteredBuiltinList = useMemo(() => {
      // Cast to LobeToolMetaWithAvailability for type safety when filterAvailableInWeb is used
      type ListType = typeof builtinList;
      let list: ListType = builtinList;

      // Filter by availableInWeb if requested (only makes sense when using allMetaList)
      if (filterAvailableInWeb && useAllMetaList) {
        list = (list as LobeToolMetaWithAvailability[]).filter(
          (item) => item.availableInWeb,
        ) as ListType;
      }

      // Filter out Klavis tools if Klavis is enabled
      if (isKlavisEnabledInEnv) {
        list = list.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier));
      }

      // Filter out skills (they are shown separately)
      list = list.filter((item) => !allSkillIdentifiers.has(item.identifier));

      return list;
    }, [
      builtinList,
      allKlavisTypeIdentifiers,
      isKlavisEnabledInEnv,
      filterAvailableInWeb,
      useAllMetaList,
      allSkillIdentifiers,
    ]);

    // Klavis server list items
    const klavisServerItems = useMemo(
      () =>
        isKlavisEnabledInEnv
          ? KLAVIS_SERVER_TYPES.map((type) => ({
              icon: <KlavisSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />,
              key: type.identifier,
              label: (
                <KlavisServerItem
                  agentId={effectiveAgentId}
                  identifier={type.identifier}
                  label={type.label}
                  server={getServerByName(type.identifier)}
                  serverName={type.serverName}
                />
              ),
              popoverContent: (
                <ToolItemDetailPopover
                  icon={<KlavisSkillIcon icon={type.icon} label={type.label} size={36} />}
                  identifier={type.identifier}
                  sourceLabel={type.author}
                  title={type.label}
                  description={t(`tools.klavis.servers.${type.identifier}.description` as any, {
                    defaultValue: type.description,
                  })}
                />
              ),
            }))
          : [],
      [isKlavisEnabledInEnv, allKlavisServers, effectiveAgentId, t],
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
      [isLobehubSkillEnabled, allLobehubSkillServers, effectiveAgentId, t],
    );

    // Handle plugin remove via Tag close - use byId actions
    const handleRemovePlugin =
      (
        pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> },
      ) =>
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          if (!effectiveAgentId) return;
          await updateAgentChatConfigById(effectiveAgentId, { searchMode: 'off' });
        } else {
          await togglePlugin(identifier, false);
        }
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

    // Merge Builtin Agent Skills, builtin tools, LobeHub Skill Providers, and Klavis servers
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
        // 4. Klavis servers
        ...klavisServerItems,
      ],
      [
        builtinAgentSkillItems,
        filteredBuiltinList,
        klavisServerItems,
        lobehubSkillItems,
        isToolEnabled,
        handleToggleTool,
        t,
      ],
    );

    // Distinguish community plugins from custom plugins
    const communityPlugins = installedPluginList.filter((item) => item.type !== 'customPlugin');
    const customPlugins = installedPluginList.filter((item) => item.type === 'customPlugin');

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

    // Custom group children (User Agent Skills + custom plugins)
    const customGroupChildren = useMemo(
      () => [...userAgentSkillItems, ...customPluginItems],
      [userAgentSkillItems, customPluginItems],
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

    // Installed tab items - only show enabled items
    const installedTabItems: ItemType[] = useMemo(() => {
      const items: ItemType[] = [];

      // Enabled builtin tools
      const enabledBuiltinItems = filteredBuiltinList
        .filter((item) => isToolEnabled(item.identifier))
        .map((item) => ({
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
              checked={true}
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
        }));

      // Connected and enabled Klavis servers
      const connectedKlavisItems = klavisServerItems.filter((item) =>
        plugins.includes(item.key as string),
      );

      // Connected LobeHub Skill Providers
      const connectedLobehubSkillItems = lobehubSkillItems.filter((item) =>
        plugins.includes(item.key as string),
      );

      // Enabled Builtin Agent Skills
      const enabledBuiltinAgentSkillItems = installedBuiltinSkills
        .filter((skill) => isToolEnabled(skill.identifier))
        .map((skill) => ({
          icon: skill.avatar ? (
            <Avatar avatar={skill.avatar} size={SKILL_ICON_SIZE} style={{ marginInlineEnd: 0 }} />
          ) : (
            <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
          ),
          key: skill.identifier,
          label: (
            <ToolItem
              checked={true}
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
              identifier={skill.identifier}
              sourceLabel={t('skillStore.tabs.lobehub')}
              title={skill.name}
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
            />
          ),
        }));

      // LobeHub group (Builtin Agent Skills + builtin + LobeHub Skill + Klavis)
      const lobehubGroupItems = [
        ...enabledBuiltinAgentSkillItems,
        ...enabledBuiltinItems,
        ...connectedLobehubSkillItems,
        ...connectedKlavisItems,
      ];

      if (lobehubGroupItems.length > 0) {
        items.push({
          children: lobehubGroupItems,
          key: 'installed-lobehub',
          label: t('skillStore.tabs.lobehub'),
          type: 'group',
        });
      }

      // Enabled community plugins
      const enabledCommunityPlugins = communityPlugins
        .filter((item) => plugins.includes(item.identifier))
        .map((item) => {
          const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
          return {
            icon: isMcp ? (
              <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
            ) : (
              <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
            ),
            key: item.identifier,
            label: (
              <ToolItem
                checked={true}
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
                sourceLabel={t('skillStore.tabs.community')}
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
        });

      // Enabled Market Agent Skills
      const enabledMarketAgentSkillItems = marketAgentSkills
        .filter((skill) => isToolEnabled(skill.identifier))
        .map((skill) => ({
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
              checked={true}
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
        }));

      // Community group (Market Agent Skills + community plugins)
      const allCommunityItems = [...enabledMarketAgentSkillItems, ...enabledCommunityPlugins];
      if (allCommunityItems.length > 0) {
        items.push({
          children: allCommunityItems,
          key: 'installed-community',
          label: t('skillStore.tabs.community'),
          type: 'group',
        });
      }

      // Enabled custom plugins
      const enabledCustomPlugins = customPlugins
        .filter((item) => plugins.includes(item.identifier))
        .map((item) => {
          const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
          return {
            icon: isMcp ? (
              <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
            ) : (
              <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
            ),
            key: item.identifier,
            label: (
              <ToolItem
                checked={true}
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
                sourceLabel={t('skillStore.tabs.custom')}
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
        });

      // Enabled User Agent Skills
      const enabledUserAgentSkillItems = userAgentSkills
        .filter((skill) => isToolEnabled(skill.identifier))
        .map((skill) => ({
          icon: <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />,
          key: skill.identifier,
          label: (
            <ToolItem
              checked={true}
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
        }));

      // Custom group (User Agent Skills + custom plugins)
      const allCustomItems = [...enabledUserAgentSkillItems, ...enabledCustomPlugins];
      if (allCustomItems.length > 0) {
        items.push({
          children: allCustomItems,
          key: 'installed-custom',
          label: t('skillStore.tabs.custom'),
          type: 'group',
        });
      }

      return items;
    }, [
      filteredBuiltinList,
      installedBuiltinSkills,
      marketAgentSkills,
      userAgentSkills,
      klavisServerItems,
      lobehubSkillItems,
      communityPlugins,
      customPlugins,
      plugins,
      isToolEnabled,
      handleToggleTool,
      togglePlugin,
      t,
    ]);

    // Use effective tab for display (default to all while initializing)
    const effectiveTab = activeTab ?? 'all';

    const button = (
      <Button
        icon={PlusIcon}
        loading={updating}
        size={'small'}
        style={{ color: cssVar.colorTextSecondary }}
        type={'text'}
      >
        {t('tools.add', { defaultValue: 'Add' })}
      </Button>
    );

    // Combine plugins and web browsing for display
    const allEnabledTools = useMemo(() => {
      const tools = [...plugins];
      // Add web browsing if enabled (it's not in plugins array)
      if (showWebBrowsing && isSearchEnabled && !tools.includes(WEB_BROWSING_IDENTIFIER)) {
        tools.unshift(WEB_BROWSING_IDENTIFIER);
      }
      return tools;
    }, [plugins, isSearchEnabled, showWebBrowsing]);

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
                  activeTab={effectiveTab}
                  allTabItems={allTabItems}
                  installedTabItems={installedTabItems}
                  onClose={() => setDropdownOpen(false)}
                  onTabChange={setActiveTab}
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
              onOpenChange={setDropdownOpen}
            >
              {button}
            </ActionDropdown>
          </Suspense>
          {/* Selected Plugins as Tags */}
          {allEnabledTools.map((pluginId) => {
            return (
              <PluginTag
                key={pluginId}
                pluginId={pluginId}
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
