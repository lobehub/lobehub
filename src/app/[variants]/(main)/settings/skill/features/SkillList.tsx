'use client';

import {
  KLAVIS_SERVER_TYPES,
  type KlavisServerType,
  LOBEHUB_SKILL_PROVIDERS,
  type LobehubSkillProviderType,
} from '@lobechat/const';
import { Form, FormGroup } from '@lobehub/ui';
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

import InstalledSkillList from './InstalledSkillList';
import KlavisSkillItem from './KlavisSkillItem';
import LobehubSkillItem from './LobehubSkillItem';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
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

  // Merge and sort all integration skills: connected first
  const sortedIntegrationSkills = useMemo(() => {
    type LobehubSkillItem =
      | { provider: LobehubSkillProviderType; type: 'lobehub' }
      | { serverType: KlavisServerType; type: 'klavis' };

    const items: LobehubSkillItem[] = [];

    if (isLobehubSkillEnabled) {
      for (const provider of LOBEHUB_SKILL_PROVIDERS) {
        items.push({ provider, type: 'lobehub' });
      }
    }

    if (isKlavisEnabled) {
      for (const serverType of KLAVIS_SERVER_TYPES) {
        items.push({ serverType, type: 'klavis' });
      }
    }

    return items.sort((a, b) => {
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
  }, [isLobehubSkillEnabled, isKlavisEnabled, allLobehubSkillServers, allKlavisServers]);

  const hasIntegrations = sortedIntegrationSkills.length > 0;
  const hasInstalledPlugins = installedPluginList.length > 0;
  const hasAnySkills = hasIntegrations || hasInstalledPlugins;

  if (!hasAnySkills) {
    return (
      <div className={styles.container}>
        <p className={styles.description}>{t('tab.skillDesc')}</p>
        <div className={styles.empty}>{t('tab.skillEmpty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <p className={styles.description}>{t('tab.skillDesc')}</p>

      {hasInstalledPlugins && (
        <Form>
          <FormGroup title={t('tab.skillInstalled')}>
            <InstalledSkillList />
          </FormGroup>
        </Form>
      )}

      {hasIntegrations && (
        <Form>
          <FormGroup title={t('tab.skillIntegration')}>
            {sortedIntegrationSkills.map((item) =>
              item.type === 'lobehub' ? (
                <LobehubSkillItem
                  key={item.provider.id}
                  provider={item.provider}
                  server={getLobehubSkillServerByProvider(item.provider.id)}
                />
              ) : (
                <KlavisSkillItem
                  key={item.serverType.identifier}
                  server={getKlavisServerByIdentifier(item.serverType.identifier)}
                  serverType={item.serverType}
                />
              ),
            )}
          </FormGroup>
        </Form>
      )}
    </div>
  );
});

SkillList.displayName = 'SkillList';

export default SkillList;
