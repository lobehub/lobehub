'use client';

import {
  COMPOSIO_APP_TYPES,
  type ComposioAppType,
  getComposioAppByIdentifier,
  getLobehubSkillProviderById,
  LOBEHUB_SKILL_PROVIDERS,
  type LobehubSkillProviderType,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
} from '@lobechat/const';
import { type BuiltinSkill, type LobeBuiltinTool } from '@lobechat/types';
import { Center, Empty } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import type React from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
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
import { connectorSelectors } from '@/store/tool/slices/connector';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { type LobeToolType } from '@/types/tool/tool';

import AgentSkillItem from './AgentSkillItem';
import BuiltinSkillItem from './BuiltinSkillItem';
import ComposioSkillItem from './ComposioSkillItem';
import LobehubSkillItem from './LobehubSkillItem';
import McpSkillItem from './McpSkillItem';
import type { ToolDetailType } from './SkillDetail';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  description: css`
    margin-block-end: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
  empty: css`
    padding: 24px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  sectionHeader: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 12px 4px;
    padding-inline: 4px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

export type SkillViewMode = 'connector' | 'skill';

interface SkillListProps {
  onDeleteSelected?: () => void;
  onSelect?: (identifier: string, type: ToolDetailType) => void;
  selectedIdentifier?: string;
  viewMode?: SkillViewMode;
}

const SkillList = memo<SkillListProps>(
  ({ onSelect, onDeleteSelected, selectedIdentifier, viewMode = 'connector' }) => {
    const { t } = useTranslation('setting');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
    const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
    const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
    const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
    const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
    const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
    const customConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);
    const isConnectorsInit = useToolStore((s) => s.isConnectorsInit);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const allBuiltinTools = useToolStore((s) => s.builtinTools, isEqual);
    const uninstalledBuiltinTools = useToolStore(
      builtinToolSelectors.uninstalledBuiltinTools,
      isEqual,
    );

    const [
      useFetchLobehubSkillConnections,
      useFetchUserComposioConnections,
      useFetchAgentSkills,
      useFetchUninstalledBuiltinTools,
    ] = useToolStore((s) => [
      s.useFetchLobehubSkillConnections,
      s.useFetchUserComposioConnections,
      s.useFetchAgentSkills,
      s.useFetchUninstalledBuiltinTools,
    ]);

    useFetchInstalledPlugins();
    useFetchLobehubSkillConnections(isLobehubSkillEnabled);
    useFetchUserComposioConnections(isComposioEnabled);
    useFetchAgentSkills(true);
    useFetchUninstalledBuiltinTools(true);

    // Load custom connectors (new connector store) so user-added OAuth MCP
    // connectors appear in the Connectors tab list.
    useEffect(() => {
      if (!isConnectorsInit) fetchConnectors();
    }, [isConnectorsInit, fetchConnectors]);

    const getLobehubSkillServerByProvider = (providerId: string) => {
      return allLobehubSkillServers.find((server) => server.identifier === providerId);
    };

    const getComposioServerByIdentifier = (identifier: string) => {
      return allComposioServers.find((server) => server.identifier === identifier);
    };

    const getBuiltinToolByIdentifier = (identifier: string) => {
      return allBuiltinTools.find((tool) => tool.identifier === identifier);
    };

    const isBuiltinToolInstalled = (identifier: string) => {
      return !uninstalledBuiltinTools.includes(identifier);
    };

    // Separate skills into three categories:
    // 1. Integrations (Builtin, LobeHub and Composio skills)
    // 2. Community MCP Tools (type === 'plugin')
    // 3. Custom MCP Tools (type === 'customPlugin')
    const { integrations, communityMCPs, customMCPs } = useMemo(() => {
      type IntegrationItem =
        | { builtinAgentSkill: BuiltinSkill; type: 'builtinAgent' }
        | { builtinTool: LobeBuiltinTool; type: 'builtin' }
        | { provider: LobehubSkillProviderType; type: 'lobehub' }
        | { serverType: ComposioAppType; type: 'composio' };

      let integrationItems: IntegrationItem[] = [];

      // Add builtin agent skills first so they appear early in the list
      for (const skill of builtinSkills) {
        integrationItems.push({ builtinAgentSkill: skill, type: 'builtinAgent' });
      }

      const addedBuiltinIds = new Set<string>();
      const addedLobehubIds = new Set<string>();
      const addedComposioIds = new Set<string>();

      // If RECOMMENDED_SKILLS is configured, use it to build the list
      if (RECOMMENDED_SKILLS.length > 0) {
        for (const skill of RECOMMENDED_SKILLS) {
          if (skill.type === RecommendedSkillType.Builtin) {
            const builtinTool = getBuiltinToolByIdentifier(skill.id);
            if (builtinTool && !builtinTool.hidden) {
              integrationItems.push({ builtinTool, type: 'builtin' });
              addedBuiltinIds.add(skill.id);
            }
          } else if (skill.type === RecommendedSkillType.Lobehub && isLobehubSkillEnabled) {
            const provider = getLobehubSkillProviderById(skill.id);
            if (provider) {
              integrationItems.push({ provider, type: 'lobehub' });
              addedLobehubIds.add(skill.id);
            }
          } else if (skill.type === RecommendedSkillType.Composio && isComposioEnabled) {
            const serverType = getComposioAppByIdentifier(skill.id);
            if (serverType) {
              integrationItems.push({ serverType, type: 'composio' });
              addedComposioIds.add(skill.id);
            }
          }
        }

        // Also add installed builtin tools that are not in RECOMMENDED_SKILLS
        for (const tool of allBuiltinTools) {
          if (
            !tool.hidden &&
            isBuiltinToolInstalled(tool.identifier) &&
            !addedBuiltinIds.has(tool.identifier)
          ) {
            integrationItems.push({ builtinTool: tool, type: 'builtin' });
          }
        }

        // Also add connected Lobehub skills that are not in RECOMMENDED_SKILLS
        if (isLobehubSkillEnabled) {
          for (const server of allLobehubSkillServers) {
            if (
              server.status === LobehubSkillStatus.CONNECTED &&
              !addedLobehubIds.has(server.identifier)
            ) {
              const provider = getLobehubSkillProviderById(server.identifier);
              if (provider) {
                integrationItems.push({ provider, type: 'lobehub' });
              }
            }
          }
        }

        // Also add connected Composio skills that are not in RECOMMENDED_SKILLS
        if (isComposioEnabled) {
          for (const server of allComposioServers) {
            if (
              server.status === ComposioServerStatus.ACTIVE &&
              !addedComposioIds.has(server.identifier)
            ) {
              const serverType = getComposioAppByIdentifier(server.identifier);
              if (serverType) {
                integrationItems.push({ serverType, type: 'composio' });
              }
            }
          }
        }
      } else {
        // Default behavior: add all non-hidden builtin tools
        for (const tool of allBuiltinTools) {
          if (!tool.hidden) {
            integrationItems.push({ builtinTool: tool, type: 'builtin' });
          }
        }

        // Add lobehub skills
        if (isLobehubSkillEnabled) {
          for (const provider of LOBEHUB_SKILL_PROVIDERS) {
            integrationItems.push({ provider, type: 'lobehub' });
          }
        }

        // Add composio skills
        if (isComposioEnabled) {
          for (const serverType of COMPOSIO_APP_TYPES) {
            integrationItems.push({ serverType, type: 'composio' });
          }
        }

        // Filter integrations: show all builtin and lobehub skills, but only connected composio
        integrationItems = integrationItems.filter((item) => {
          if (item.type === 'builtinAgent' || item.type === 'builtin' || item.type === 'lobehub') {
            return true;
          }
          return (
            getComposioServerByIdentifier(item.serverType.identifier)?.status ===
            ComposioServerStatus.ACTIVE
          );
        });
      }

      // Sort integrations: installed/connected ones first
      const getIsConnected = (item: IntegrationItem) => {
        switch (item.type) {
          case 'builtinAgent': {
            return isBuiltinToolInstalled(item.builtinAgentSkill.identifier);
          }
          case 'builtin': {
            return isBuiltinToolInstalled(item.builtinTool.identifier);
          }
          case 'lobehub': {
            return (
              getLobehubSkillServerByProvider(item.provider.id)?.status ===
              LobehubSkillStatus.CONNECTED
            );
          }
          case 'composio': {
            return (
              getComposioServerByIdentifier(item.serverType.identifier)?.status ===
              ComposioServerStatus.ACTIVE
            );
          }
        }
      };
      const sortedIntegrations = integrationItems.sort((a, b) => {
        const isConnectedA = getIsConnected(a);
        const isConnectedB = getIsConnected(b);

        if (isConnectedA && !isConnectedB) return -1;
        if (!isConnectedA && isConnectedB) return 1;
        return 0;
      });

      // Separate installed plugins into community and custom
      const communityPlugins = installedPluginList.filter((plugin) => plugin.type === 'plugin');
      const customPlugins = installedPluginList.filter((plugin) => plugin.type === 'customPlugin');

      return {
        communityMCPs: communityPlugins,
        customMCPs: customPlugins,
        integrations: sortedIntegrations,
      };
    }, [
      installedPluginList,
      isLobehubSkillEnabled,
      isComposioEnabled,
      allLobehubSkillServers,
      allComposioServers,
      allBuiltinTools,
      uninstalledBuiltinTools,
      builtinSkills,
    ]);

    const hasAnySkills =
      builtinSkills.length > 0 ||
      integrations.length > 0 ||
      marketAgentSkills.length > 0 ||
      userAgentSkills.length > 0 ||
      communityMCPs.length > 0 ||
      customMCPs.length > 0;

    if (!hasAnySkills) {
      return (
        <Center className={styles.container} paddingBlock={48}>
          <Empty description={t('tab.skillDesc')} icon={SkillsIcon} title={t('tab.skillEmpty')} />
        </Center>
      );
    }

    const renderMarketAgentSkills = () =>
      marketAgentSkills.map((skill) => (
        <AgentSkillItem
          isSelected={selectedIdentifier === skill.id}
          key={skill.id}
          skill={skill}
          onSelect={onSelect ? () => onSelect(skill.id, 'agent-skill') : undefined}
        />
      ));

    const renderUserAgentSkills = () =>
      userAgentSkills.map((skill) => (
        <AgentSkillItem
          isSelected={selectedIdentifier === skill.id}
          key={skill.id}
          skill={skill}
          onSelect={onSelect ? () => onSelect(skill.id, 'agent-skill') : undefined}
        />
      ));

    const renderCommunityMCPs = () =>
      communityMCPs.map((plugin) => (
        <McpSkillItem
          author={plugin.author}
          avatar={plugin.avatar}
          identifier={plugin.identifier}
          isSelected={selectedIdentifier === plugin.identifier}
          key={plugin.identifier}
          runtimeType={plugin.runtimeType}
          title={plugin.title || plugin.identifier}
          type={plugin.type as LobeToolType}
          onSelect={onSelect ? () => onSelect(plugin.identifier, 'plugin') : undefined}
        />
      ));

    const renderCustomMCPs = () =>
      customMCPs.map((plugin) => (
        <McpSkillItem
          author={plugin.author}
          avatar={plugin.avatar}
          identifier={plugin.identifier}
          isSelected={selectedIdentifier === plugin.identifier}
          key={plugin.identifier}
          runtimeType={plugin.runtimeType}
          title={plugin.title || plugin.identifier}
          type={plugin.type as LobeToolType}
          onSelect={onSelect ? () => onSelect(plugin.identifier, 'mcp-connector') : undefined}
        />
      ));

    // Custom connectors from the connector store (user-added OAuth MCP servers)
    const renderCustomConnectors = () =>
      customConnectors.map((c) => (
        <McpSkillItem
          identifier={c.identifier}
          isSelected={selectedIdentifier === c.identifier}
          key={c.id}
          runtimeType="mcp"
          title={c.name || c.identifier}
          type={'customPlugin' as LobeToolType}
          onSelect={onSelect ? () => onSelect(c.identifier, 'mcp-connector') : undefined}
        />
      ));

    // Split integrations into builtin tools vs builtin skills
    const builtinToolItems = integrations.filter((i) => i.type === 'builtin');
    const builtinSkillItems = integrations.filter((i) => i.type === 'builtinAgent');
    const communitySkillItems = integrations.filter(
      (i) => i.type === 'lobehub' || i.type === 'composio',
    );

    const toggleSection = (key: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const renderSection = (key: string, label: string, children: React.ReactNode) => {
      const isCollapsed = collapsed.has(key);
      return (
        <>
          <div className={styles.sectionHeader} onClick={() => toggleSection(key)}>
            {isCollapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
            {label}
          </div>
          {!isCollapsed && children}
        </>
      );
    };

    const isConnectorView = viewMode === 'connector';

    // Connectors tab: tools/MCP items (provide API-level permissions)
    // Skills tab: prompt/agent-based skills (show description/content)
    const hasBuiltinTools = builtinToolItems.length > 0 && isConnectorView;
    const hasBuiltinSkills = builtinSkillItems.length > 0 && !isConnectorView;
    // Skills tab only shows agent-based community skills; Lobehub/Composio OAuth
    // connectors live exclusively in the Connectors view (hasCommunityConnectors).
    const hasCommunitySkills = !isConnectorView && marketAgentSkills.length > 0;
    const hasCommunityTools = communityMCPs.length > 0 && isConnectorView;
    // In connector view: custom MCPs (old plugins) + custom connectors (new store).
    // In skill view: user agent skills
    const hasCustomConnectors =
      isConnectorView && (customMCPs.length > 0 || customConnectors.length > 0);
    const hasCustomSkills = userAgentSkills.length > 0 && !isConnectorView;
    // Lobehub/Composio OAuth skills go in Connectors tab (they provide tools)
    const hasCommunityConnectors = communitySkillItems.length > 0 && isConnectorView;

    return (
      <div className={styles.container}>
        {hasBuiltinTools &&
          renderSection(
            'builtinTools',
            t('skillGroup.builtinTools', 'Built-in Tools'),
            builtinToolItems.map((item) => {
              if (item.type !== 'builtin') return null;
              const localizedTitle = t(`tools.builtins.${item.builtinTool.identifier}.title`, {
                defaultValue: item.builtinTool.manifest.meta?.title || item.builtinTool.identifier,
              });
              return (
                <BuiltinSkillItem
                  avatar={item.builtinTool.manifest.meta?.avatar}
                  identifier={item.builtinTool.identifier}
                  isSelected={selectedIdentifier === item.builtinTool.identifier}
                  key={item.builtinTool.identifier}
                  title={localizedTitle}
                  onSelect={
                    onSelect ? () => onSelect(item.builtinTool.identifier, 'builtin') : undefined
                  }
                />
              );
            }),
          )}

        {hasBuiltinSkills &&
          renderSection(
            'builtinSkills',
            t('skillGroup.builtinSkills', 'Built-in Skills'),
            builtinSkillItems.map((item) => {
              if (item.type !== 'builtinAgent') return null;
              return (
                <AgentSkillItem
                  isSelected={selectedIdentifier === item.builtinAgentSkill.identifier}
                  key={item.builtinAgentSkill.identifier}
                  skill={item.builtinAgentSkill}
                  onSelect={
                    onSelect
                      ? () => onSelect(item.builtinAgentSkill.identifier, 'builtin-skill')
                      : undefined
                  }
                />
              );
            }),
          )}

        {/* Connector view: Lobehub/Composio OAuth connectors */}
        {hasCommunityConnectors &&
          renderSection(
            'communityConnectors',
            t('skillGroup.communityConnectors', 'OAuth Connectors'),
            communitySkillItems.map((item) => {
              if (item.type === 'lobehub') {
                return (
                  <LobehubSkillItem
                    isSelected={selectedIdentifier === item.provider.id}
                    key={item.provider.id}
                    provider={item.provider}
                    server={getLobehubSkillServerByProvider(item.provider.id)}
                    onDelete={onDeleteSelected}
                    onSelect={
                      onSelect ? () => onSelect(item.provider.id, 'lobehub-connector') : undefined
                    }
                  />
                );
              }
              return (
                <ComposioSkillItem
                  isSelected={selectedIdentifier === item.serverType.identifier}
                  key={item.serverType.identifier}
                  server={getComposioServerByIdentifier(item.serverType.identifier)}
                  serverType={item.serverType}
                  onDelete={onDeleteSelected}
                  onSelect={
                    onSelect ? () => onSelect(item.serverType.identifier, 'plugin') : undefined
                  }
                />
              );
            }),
          )}

        {/* Skill view: community agent skills only (OAuth connectors are in the Connectors view) */}
        {hasCommunitySkills &&
          renderSection(
            'communitySkills',
            t('skillGroup.communitySkills', 'Community Skills'),
            renderMarketAgentSkills(),
          )}

        {hasCommunityTools &&
          renderSection(
            'communityTools',
            t('skillGroup.communityTools', 'Community Tools'),
            renderCommunityMCPs(),
          )}

        {hasCustomConnectors &&
          renderSection(
            'customConnectors',
            t('skillGroup.customConnectors', 'Custom Connectors'),
            <>
              {renderCustomConnectors()}
              {renderCustomMCPs()}
            </>,
          )}

        {hasCustomSkills &&
          renderSection(
            'customSkills',
            t('skillGroup.customSkills', 'Custom Skills'),
            renderUserAgentSkills(),
          )}
      </div>
    );
  },
);

SkillList.displayName = 'SkillList';

export default SkillList;
