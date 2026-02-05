'use client';

import type {KlavisServerType, LobehubSkillProviderType} from '@lobechat/const';
import {
  getKlavisServerByServerIdentifier,
  getLobehubSkillProviderById,
  KLAVIS_SERVER_TYPES,
  LOBEHUB_SKILL_PROVIDERS,
  RECOMMENDED_SKILLS,
  RecommendedSkillType
} from '@lobechat/const';
import { Center, Empty } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { BlocksIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AddSkillButton from '@/features/SkillStore/SkillList/AddSkillButton';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import type {LobeToolType} from '@/types/tool/tool';

import KlavisSkillItem from './KlavisSkillItem';
import LobehubSkillItem from './LobehubSkillItem';
import McpSkillItem from './McpSkillItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
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
}));

const SkillList = memo(() => {
  const { t } = useTranslation('setting');

  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  const [useFetchLobehubSkillConnections, useFetchUserKlavisServers] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserKlavisServers,
  ]);

  useFetchInstalledPlugins();
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserKlavisServers(isKlavisEnabled);

  const getLobehubSkillServerByProvider = (providerId: string) => {
    return allLobehubSkillServers.find((server) => server.identifier === providerId);
  };

  const getKlavisServerByIdentifier = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  // Separate skills into three categories:
  // 1. Integrations (connected LobHub and Klavis)
  // 2. Community MCP Tools (type === 'plugin')
  // 3. Custom MCP Tools (type === 'customPlugin')
  const { integrations, communityMCPs, customMCPs } = useMemo(() => {
    type IntegrationItem =
      | { provider: LobehubSkillProviderType; type: 'lobehub' }
      | { serverType: KlavisServerType; type: 'klavis' };

    let integrationItems: IntegrationItem[] = [];

    // If RECOMMENDED_SKILLS is configured, use it to build the list
    if (RECOMMENDED_SKILLS.length > 0) {
      const addedLobehubIds = new Set<string>();
      const addedKlavisIds = new Set<string>();

      for (const skill of RECOMMENDED_SKILLS) {
        if (skill.type === RecommendedSkillType.Lobehub && isLobehubSkillEnabled) {
          const provider = getLobehubSkillProviderById(skill.id);
          if (provider) {
            integrationItems.push({ provider, type: 'lobehub' });
          }
        } else if (skill.type === RecommendedSkillType.Klavis && isKlavisEnabled) {
          const serverType = getKlavisServerByServerIdentifier(skill.id);
          if (serverType) {
            integrationItems.push({ serverType, type: 'klavis' });
            addedKlavisIds.add(skill.id);
          }
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
      // Default behavior: add all lobehub skills
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

      // Filter integrations: show all lobehub skills, but only connected klavis
      integrationItems = integrationItems.filter((item) => {
        if (item.type === 'lobehub') {
          return true;
        }
        return (
          getKlavisServerByIdentifier(item.serverType.identifier)?.status ===
          KlavisServerStatus.CONNECTED
        );
      });
    }

    // Sort integrations: connected ones first
    const sortedIntegrations = integrationItems.sort((a, b) => {
      const isConnectedA =
        a.type === 'lobehub'
          ? getLobehubSkillServerByProvider(a.provider.id)?.status === LobehubSkillStatus.CONNECTED
          : getKlavisServerByIdentifier(a.serverType.identifier)?.status ===
            KlavisServerStatus.CONNECTED;
      const isConnectedB =
        b.type === 'lobehub'
          ? getLobehubSkillServerByProvider(b.provider.id)?.status === LobehubSkillStatus.CONNECTED
          : getKlavisServerByIdentifier(b.serverType.identifier)?.status ===
            KlavisServerStatus.CONNECTED;

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
  ]);

  const hasAnySkills = integrations.length > 0 || communityMCPs.length > 0 || customMCPs.length > 0;

  if (!hasAnySkills) {
    return (
      <Center className={styles.container} paddingBlock={48}>
        <Empty description={t('tab.skillDesc')} icon={BlocksIcon} title={t('tab.skillEmpty')} />
        <AddSkillButton />
      </Center>
    );
  }

  const renderIntegrations = () =>
    integrations.map((item) => {
      if (item.type === 'lobehub') {
        return (
          <LobehubSkillItem
            key={item.provider.id}
            provider={item.provider}
            server={getLobehubSkillServerByProvider(item.provider.id)}
          />
        );
      }
      return (
        <KlavisSkillItem
          key={item.serverType.identifier}
          server={getKlavisServerByIdentifier(item.serverType.identifier)}
          serverType={item.serverType}
        />
      );
    });

  const renderCommunityMCPs = () =>
    communityMCPs.map((plugin) => (
      <McpSkillItem
        author={plugin.author}
        avatar={plugin.avatar}
        identifier={plugin.identifier}
        key={plugin.identifier}
        runtimeType={plugin.runtimeType}
        title={plugin.title || plugin.identifier}
        type={plugin.type as LobeToolType}
      />
    ));

  const renderCustomMCPs = () =>
    customMCPs.map((plugin) => (
      <McpSkillItem
        author={plugin.author}
        avatar={plugin.avatar}
        identifier={plugin.identifier}
        key={plugin.identifier}
        runtimeType={plugin.runtimeType}
        title={plugin.title || plugin.identifier}
        type={plugin.type as LobeToolType}
      />
    ));

  return (
    <div className={styles.container}>
      {integrations.length > 0 && renderIntegrations()}
      {integrations.length > 0 && communityMCPs.length > 0 && <Divider style={{ margin: 0 }} />}
      {communityMCPs.length > 0 && renderCommunityMCPs()}
      {(integrations.length > 0 || communityMCPs.length > 0) && customMCPs.length > 0 && (
        <Divider style={{ margin: 0 }} />
      )}
      {customMCPs.length > 0 && renderCustomMCPs()}
      <div style={{ marginTop: 8 }}>
        <AddSkillButton />
      </div>
    </div>
  );
});

SkillList.displayName = 'SkillList';

export default SkillList;
