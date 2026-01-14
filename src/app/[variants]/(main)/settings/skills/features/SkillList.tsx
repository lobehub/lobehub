'use client';

import { LOBEHUB_SKILL_PROVIDERS, type LobehubSkillProviderType } from '@lobechat/const';
import { Form, FormGroup } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors, pluginSelectors } from '@/store/tool/selectors';

import CustomSkillItem from './CustomSkillItem';
import IntegrationSkillItem from './IntegrationSkillItem';

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
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const customPluginList = useToolStore(pluginSelectors.installedCustomPluginMetaList, isEqual);

  const [useFetchLobehubSkillConnections] = useToolStore((s) => [s.useFetchLobehubSkillConnections]);

  useFetchInstalledPlugins();
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);

  const getServerByProvider = (providerId: string) => {
    return allLobehubSkillServers.find((server) => server.identifier === providerId);
  };

  const hasIntegrations = isLobehubSkillEnabled && LOBEHUB_SKILL_PROVIDERS.length > 0;
  const hasCustomSkills = customPluginList.length > 0;
  const hasAnySkills = hasIntegrations || hasCustomSkills;

  if (!hasAnySkills) {
    return (
      <div className={styles.container}>
        <p className={styles.description}>{t('tab.skillsDesc')}</p>
        <div className={styles.empty}>{t('tab.skillsEmpty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <p className={styles.description}>{t('tab.skillsDesc')}</p>

      {hasIntegrations && (
        <Form>
          <FormGroup title={t('tab.skillsIntegrations')}>
            {LOBEHUB_SKILL_PROVIDERS.map((provider: LobehubSkillProviderType) => (
              <IntegrationSkillItem
                key={provider.id}
                provider={provider}
                server={getServerByProvider(provider.id)}
              />
            ))}
          </FormGroup>
        </Form>
      )}

      {hasCustomSkills && (
        <Form>
          <FormGroup title={t('tab.skillsCustom')}>
            {customPluginList.map((plugin) => (
              <CustomSkillItem key={plugin.identifier} plugin={plugin} />
            ))}
          </FormGroup>
        </Form>
      )}
    </div>
  );
});

SkillList.displayName = 'SkillList';

export default SkillList;
