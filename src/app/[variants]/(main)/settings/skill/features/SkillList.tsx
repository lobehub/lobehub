'use client';

import {
  KLAVIS_SERVER_TYPES,
  type KlavisServerType,
  LOBEHUB_SKILL_PROVIDERS,
  type LobehubSkillProviderType,
} from '@lobechat/const';
import { Divider } from 'antd';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
import { type LobeToolType } from '@/types/tool/tool';

import InstalledSkillItem from './InstalledSkillItem';
import KlavisSkillItem from './KlavisSkillItem';
import LobehubSkillItem from './LobehubSkillItem';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  description: css`
    margin-block-end: 8px;
    color: ${token.colorTextSecondary};
  `,
  empty: css`
    padding: 24px;
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
}));

const SkillList = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();

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

    const integrationItems: IntegrationItem[] = [];

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

    // Filter integrations: show all lobehub skills, but only connected klavis
    const filteredIntegrations = integrationItems.filter((item) => {
      if (item.type === 'lobehub') {
        return true;
      }
      return (
        getKlavisServerByIdentifier(item.serverType.identifier)?.status ===
        KlavisServerStatus.CONNECTED
      );
    });

    // Sort integrations: connected ones first
    const sortedIntegrations = filteredIntegrations.sort((a, b) => {
      const isConnectedA =
        a.type === 'lobehub'
          ? getLobehubSkillServerByProvider(a.provider.id)?.status === LobehubSkillStatus.CONNECTED
          : true;
      const isConnectedB =
        b.type === 'lobehub'
          ? getLobehubSkillServerByProvider(b.provider.id)?.status === LobehubSkillStatus.CONNECTED
          : true;

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
      <div className={styles.container}>
        <p className={styles.description}>{t('tab.skillDesc')}</p>
        <div className={styles.empty}>{t('tab.skillEmpty')}</div>
      </div>
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
      <InstalledSkillItem
        author={plugin.author}
        avatar={plugin.avatar}
        description={plugin.description}
        identifier={plugin.identifier}
        key={plugin.identifier}
        runtimeType={plugin.runtimeType}
        title={plugin.title || plugin.identifier}
        type={plugin.type as LobeToolType}
      />
    ));

  const renderCustomMCPs = () =>
    customMCPs.map((plugin) => (
      <InstalledSkillItem
        author={plugin.author}
        avatar={plugin.avatar}
        description={plugin.description}
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
    </div>
  );
});

SkillList.displayName = 'SkillList';

export default SkillList;
