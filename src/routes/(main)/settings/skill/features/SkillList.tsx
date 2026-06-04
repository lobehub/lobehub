'use client';

import {
  getKlavisServerByServerIdentifier,
  getLobehubSkillProviderById,
  KLAVIS_SERVER_TYPES,
  type KlavisServerType,
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
import type React from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AddSkillButton from '@/features/SkillStore/SkillList/AddSkillButton';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { type LobeToolType } from '@/types/tool/tool';

import AgentSkillItem from './AgentSkillItem';
import BuiltinSkillItem from './BuiltinSkillItem';
import KlavisSkillItem from './KlavisSkillItem';
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
    padding-block: 8px 4px;
    padding-inline: 0;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

interface SkillListProps {
  onSelect?: (identifier: string, type: ToolDetailType) => void;
  selectedIdentifier?: string;
}

const SkillList = memo<SkillListProps>(({ onSelect, selectedIdentifier }) => {
  const { t } = useTranslation('setting');

  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const allBuiltinTools = useToolStore((s) => s.builtinTools, isEqual);
  const uninstalledBuiltinTools = useToolStore(
    builtinToolSelectors.uninstalledBuiltinTools,
    isEqual,
  );

  const [
    useFetchLobehubSkillConnections,
    useFetchUserKlavisServers,
    useFetchAgentSkills,
    useFetchUninstalledBuiltinTools,
  ] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserKlavisServers,
    s.useFetchAgentSkills,
    s.useFetchUninstalledBuiltinTools,
  ]);

  useFetchInstalledPlugins();
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserKlavisServers(isKlavisEnabled);
  useFetchAgentSkills(true);
  useFetchUninstalledBuiltinTools(true);

  const getLobehubSkillServerByProvider = (providerId: string) => {
    return allLobehubSkillServers.find((server) => server.identifier === providerId);
  };

  const getKlavisServerByIdentifier = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  const getBuiltinToolByIdentifier = (identifier: string) => {
    return allBuiltinTools.find((tool) => tool.identifier === identifier);
  };

  const isBuiltinToolInstalled = (identifier: string) => {
    return !uninstalledBuiltinTools.includes(identifier);
  };

  // Separate skills into three categories:
  // 1. Integrations (Builtin, LobeHub and Klavis skills)
  // 2. Community MCP Tools (type === 'plugin')
  // 3. Custom MCP Tools (type === 'customPlugin')
  const { integrations, communityMCPs, customMCPs } = useMemo(() => {
    type IntegrationItem =
      | { builtinAgentSkill: BuiltinSkill; type: 'builtinAgent' }
      | { builtinTool: LobeBuiltinTool; type: 'builtin' }
      | { provider: LobehubSkillProviderType; type: 'lobehub' }
      | { serverType: KlavisServerType; type: 'klavis' };

    let integrationItems: IntegrationItem[] = [];

    // Add builtin agent skills first so they appear early in the list
    for (const skill of builtinSkills) {
      integrationItems.push({ builtinAgentSkill: skill, type: 'builtinAgent' });
    }

    const addedBuiltinIds = new Set<string>();
    const addedLobehubIds = new Set<string>();
    const addedKlavisIds = new Set<string>();

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
        } else if (skill.type === RecommendedSkillType.Klavis && isKlavisEnabled) {
          const serverType = getKlavisServerByServerIdentifier(skill.id);
          if (serverType) {
            integrationItems.push({ serverType, type: 'klavis' });
            addedKlavisIds.add(skill.id);
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

      // Also add connected Klavis skills that are not in RECOMMENDED_SKILLS
      if (isKlavisEnabled) {
        for (const server of allKlavisServers) {
          if (
            server.status === KlavisServerStatus.CONNECTED &&
            !addedKlavisIds.has(server.identifier)
          ) {
            const serverType = getKlavisServerByServerIdentifier(server.identifier);
            if (serverType) {
              integrationItems.push({ serverType, type: 'klavis' });
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

      // Add klavis skills
      if (isKlavisEnabled) {
        for (const serverType of KLAVIS_SERVER_TYPES) {
          integrationItems.push({ serverType, type: 'klavis' });
        }
      }

      // Filter integrations: show all builtin and lobehub skills, but only connected klavis
      integrationItems = integrationItems.filter((item) => {
        if (item.type === 'builtinAgent' || item.type === 'builtin' || item.type === 'lobehub') {
          return true;
        }
        return (
          getKlavisServerByIdentifier(item.serverType.identifier)?.status ===
          KlavisServerStatus.CONNECTED
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
        case 'klavis': {
          return (
            getKlavisServerByIdentifier(item.serverType.identifier)?.status ===
            KlavisServerStatus.CONNECTED
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
    isKlavisEnabled,
    allLobehubSkillServers,
    allKlavisServers,
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
        <AddSkillButton />
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

  // Split integrations into builtin tools vs builtin skills
  const builtinToolItems = integrations.filter((i) => i.type === 'builtin');
  const builtinSkillItems = integrations.filter((i) => i.type === 'builtinAgent');
  const communitySkillItems = integrations.filter(
    (i) => i.type === 'lobehub' || i.type === 'klavis',
  );

  const renderSection = (label: string, children: React.ReactNode) => (
    <>
      <div className={styles.sectionHeader}>{label}</div>
      {children}
    </>
  );

  const hasBuiltinTools = builtinToolItems.length > 0;
  const hasBuiltinSkills = builtinSkillItems.length > 0;
  const hasCommunitySkills = communitySkillItems.length > 0 || marketAgentSkills.length > 0;
  const hasCommunityTools = communityMCPs.length > 0;
  const hasCustom = userAgentSkills.length > 0 || customMCPs.length > 0;

  return (
    <div className={styles.container}>
      {hasBuiltinTools &&
        renderSection(
          t('skillGroup.builtinTools', 'LobeHub 内置 Tools'),
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
          t('skillGroup.builtinSkills', '内置 Skill'),
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

      {hasCommunitySkills &&
        renderSection(
          t('skillGroup.communitySkills', '社区 Skill'),
          <>
            {communitySkillItems.map((item) => {
              if (item.type === 'lobehub') {
                return (
                  <LobehubSkillItem
                    isSelected={selectedIdentifier === item.provider.id}
                    key={item.provider.id}
                    provider={item.provider}
                    server={getLobehubSkillServerByProvider(item.provider.id)}
                    onSelect={onSelect ? () => onSelect(item.provider.id, 'plugin') : undefined}
                  />
                );
              }
              return (
                <KlavisSkillItem
                  isSelected={selectedIdentifier === item.serverType.identifier}
                  key={item.serverType.identifier}
                  server={getKlavisServerByIdentifier(item.serverType.identifier)}
                  serverType={item.serverType}
                  onSelect={
                    onSelect ? () => onSelect(item.serverType.identifier, 'plugin') : undefined
                  }
                />
              );
            })}
            {renderMarketAgentSkills()}
          </>,
        )}

      {hasCommunityTools &&
        renderSection(t('skillGroup.communityTools', '社区 Tools'), renderCommunityMCPs())}

      {hasCustom &&
        renderSection(
          t('skillGroup.custom', '自定义'),
          <>
            {renderCustomMCPs()}
            {renderUserAgentSkills()}
          </>,
        )}

      <div style={{ marginTop: 8 }}>
        <AddSkillButton />
      </div>
    </div>
  );
});

SkillList.displayName = 'SkillList';

export default SkillList;
